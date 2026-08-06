'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const checker = require('../bin/codex-reset-checker.js');

function createFakeHttps(responses) {
  const calls = [];
  const responseIndexes = new Map();
  const originalRequest = https.request;

  https.request = (options, callback) => {
    const call = {
      ...options,
      body: '',
    };
    calls.push(call);
    const configuredResponse = responses[options.path] || responses.default;
    const currentIndex = responseIndexes.get(options.path) || 0;
    const responseConfig = Array.isArray(configuredResponse)
      ? configuredResponse[Math.min(currentIndex, configuredResponse.length - 1)]
      : configuredResponse;
    responseIndexes.set(options.path, currentIndex + 1);
    const request = new EventEmitter();

    request.write = (chunk) => {
      call.body += String(chunk);
    };
    request.end = () => {
      if (!responseConfig) {
        request.emit('error', new Error(`沒有測試回應：${options.path}`));
        return;
      }

      if (responseConfig.error) {
        request.emit('error', responseConfig.error);
        return;
      }

      if (responseConfig.hang) {
        return;
      }

      const response = new EventEmitter();
      response.statusCode = responseConfig.statusCode === undefined ? 200 : responseConfig.statusCode;
      response.statusMessage = responseConfig.statusMessage || 'OK';
      callback(response);

      if (responseConfig.body !== undefined && responseConfig.body !== '') {
        const body = typeof responseConfig.body === 'string'
          ? responseConfig.body
          : JSON.stringify(responseConfig.body);
        response.emit('data', body);
      }

      response.emit('end');
    };
    request.destroy = () => {};

    return request;
  };

  return {
    calls,
    restore() {
      https.request = originalRequest;
    },
  };
}

async function withFakeHttps(responses, callback) {
  const fakeHttps = createFakeHttps(responses);
  try {
    return await callback(fakeHttps.calls);
  } finally {
    fakeHttps.restore();
  }
}

function createAuthFile(accessToken = 'token-secret', accountId = 'account-secret') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-reset-checker-'));
  const authPath = path.join(directory, 'auth.json');
  fs.writeFileSync(authPath, JSON.stringify({
    tokens: {
      access_token: accessToken,
      account_id: accountId,
    },
  }));

  return {
    authPath,
    cleanup() {
      fs.unlinkSync(authPath);
      fs.rmdirSync(directory);
    },
  };
}

async function captureMain(args, responses) {
  const originalArgv = process.argv;
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];

  process.argv = ['node', 'codex-reset-checker.js', ...args];
  console.log = (value = '') => stdout.push(String(value));
  console.error = (value = '') => stderr.push(String(value));

  try {
    const calls = await withFakeHttps(responses, async (requestCalls) => {
      await checker.main();
      return requestCalls;
    });

    return { stdout, stderr, calls };
  } finally {
    process.argv = originalArgv;
    console.log = originalLog;
    console.error = originalError;
  }
}

async function captureConsole(callback) {
  const originalLog = console.log;
  const originalError = console.error;
  const stdout = [];
  const stderr = [];
  console.log = (value = '') => stdout.push(String(value));
  console.error = (value = '') => stderr.push(String(value));

  try {
    const result = await callback();
    return {
      result,
      stdout,
      stderr,
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function usageResponse(now = Math.floor(Date.now() / 1000)) {
  return {
    plan_type: 'pro',
    rate_limit: {
      primary_window: {
        used_percent: 42,
        limit_window_seconds: 18000,
        reset_after_seconds: 8100,
        reset_at: now + 8100,
      },
      secondary_window: {
        used_percent: 18,
        limit_window_seconds: 604800,
        reset_after_seconds: 345600,
        reset_at: now + 345600,
      },
    },
    additional_rate_limits: [
      {
        limit_name: 'codex-spark',
        primary_window: {
          used_percent: 12,
          limit_window_seconds: 18000,
          reset_after_seconds: 7200,
          reset_at: now + 7200,
        },
        secondary_window: {
          used_percent: 8,
          limit_window_seconds: 604800,
          reset_after_seconds: 259200,
          reset_at: now + 259200,
        },
      },
    ],
  };
}

async function testNormalizeCompleteUsage() {
  const normalized = checker.normalizeUsageResponse(usageResponse(1762140000));

  assert.deepStrictEqual(normalized.primary_window, {
    name: '目前工作階段',
    used_percent: 42,
    remaining_percent: 58,
    limit_window_seconds: 18000,
    reset_after_seconds: 8100,
    reset_at: 1762148100,
  });
  assert.strictEqual(normalized.secondary_window.name, '每週額度');
  assert.strictEqual(normalized.secondary_window.remaining_percent, 82);
  assert.strictEqual(normalized.additional_rate_limits.length, 1);
  assert.strictEqual(normalized.additional_rate_limits[0].id, 'codex-spark');
  assert.strictEqual(normalized.additional_rate_limits[0].name, 'GPT-5.3-Codex-Spark');
  assert.strictEqual(normalized.additional_rate_limits[0].primary_window.used_percent, 12);
  assert.strictEqual(normalized.additional_rate_limits[0].secondary_window.remaining_percent, 92);
}

async function testNormalizeMissingAndNullWindowFields() {
  const normalized = checker.normalizeUsageResponse({
    rate_limit: {
      primary_window: {
        used_percent: null,
        reset_at: null,
      },
      secondary_window: {
        used_percent: 'not-a-number',
        reset_after_seconds: null,
      },
    },
  });

  assert.deepStrictEqual(normalized.primary_window, {
    name: '目前工作階段',
    used_percent: null,
    remaining_percent: null,
    limit_window_seconds: null,
    reset_after_seconds: null,
    reset_at: null,
  });
  assert.strictEqual(normalized.secondary_window.used_percent, null);
  assert.strictEqual(normalized.secondary_window.reset_at, null);
  assert.deepStrictEqual(normalized.additional_rate_limits, []);

  const weeklyOnly = checker.normalizeUsageResponse({
    rate_limit: {
      primary_window: null,
      secondary_window: null,
    },
    additional_rate_limits: [
      {
        limit_name: 'codex-spark-weekly',
        used_percent: 25,
        reset_after_seconds: 3600,
      },
    ],
  });
  assert.strictEqual(weeklyOnly.additional_rate_limits[0].primary_window, null);
  assert.strictEqual(weeklyOnly.additional_rate_limits[0].secondary_window.used_percent, 25);
}

async function testNormalizeWeeklyOnlyPrimaryWindow() {
  const normalized = checker.normalizeUsageResponse({
    rate_limit: {
      primary_window: {
        used_percent: 7,
        limit_window_seconds: 604800,
        reset_after_seconds: 500000,
        reset_at: 1784504427,
      },
      secondary_window: null,
    },
    additional_rate_limits: [
      {
        limit_name: 'GPT-5.3-Codex-Spark',
        rate_limit: {
          primary_window: {
            used_percent: 3,
            limit_window_seconds: 604800,
            reset_after_seconds: 510000,
            reset_at: 1784504432,
          },
          secondary_window: null,
        },
      },
    ],
  });

  assert.strictEqual(normalized.primary_window.name, '每週額度');
  assert.strictEqual(normalized.secondary_window, null);
  assert.strictEqual(normalized.additional_rate_limits[0].primary_window.name, '每週額度');
  assert.strictEqual(normalized.additional_rate_limits[0].secondary_window, null);

  const cards = checker.getUsageCards(normalized);
  assert.strictEqual(cards[0].title, '每週用量上限');
  assert.strictEqual(cards[1].title, 'GPT-5.3-Codex-Spark 每週用量上限');
}

async function testUsageLayoutUsesManualResetWidthCap() {
  const manualLayout = checker.getManualResetLayout([]);
  const usageLayout = checker.getUsageLayout([
    { title: '5 小時使用情況限制' },
    { title: '每週用量上限' },
  ], manualLayout.totalWidth);

  assert.strictEqual(manualLayout.totalWidth, 58);
  assert.strictEqual(usageLayout.boxContentWidth, 54);
  assert.strictEqual(usageLayout.twoColumns, false);
}

async function testSingleManualResetUsesFullTerminalWidth() {
  const originalColumns = process.stdout.columns;
  process.stdout.columns = 120;

  try {
    const manualLayout = checker.getManualResetLayout([
      {
        status: 'available',
        granted_at: '2026-07-13T00:00:00Z',
        expires_at: '2026-08-13T00:00:00Z',
      },
    ]);
    const usageLayout = checker.getUsageLayout([
      { title: '5 小時使用情況限制' },
      { title: '每週用量上限' },
    ], manualLayout.totalWidth);

    assert.strictEqual(manualLayout.contentWidth, 116);
    assert.strictEqual(manualLayout.totalWidth, 120);
    assert.strictEqual(manualLayout.boxContentWidth, 116);
    assert.strictEqual(manualLayout.twoColumns, false);
    assert.strictEqual(usageLayout.boxContentWidth, 116);
    assert.strictEqual(usageLayout.twoColumns, true);
  } finally {
    if (originalColumns === undefined) {
      delete process.stdout.columns;
    } else {
      process.stdout.columns = originalColumns;
    }
  }
}

async function testWatchCliOptions() {
  const longOption = checker.getCliOptions(['--watch', '--auth', '/tmp/auth.json']);
  const shortOption = checker.getCliOptions(['-w', '/tmp/short-auth.json']);
  const equalsOption = checker.getCliOptions(['--auth=/tmp/equals-auth.json']);

  assert.deepStrictEqual(longOption, {
    authPath: '/tmp/auth.json',
    json: false,
    watch: true,
    reset: false,
    resetRequestId: null,
    force: false,
    timeFormat: 'local',
    exactTime: false,
  });
  assert.deepStrictEqual(shortOption, {
    authPath: '/tmp/short-auth.json',
    json: false,
    watch: true,
    reset: false,
    resetRequestId: null,
    force: false,
    timeFormat: 'local',
    exactTime: false,
  });
  assert.strictEqual(equalsOption.authPath, '/tmp/equals-auth.json');
  assert.throws(
    () => checker.getCliOptions(['--auth']),
    /--auth 需要指定 auth\.json 路徑/
  );
  assert.throws(
    () => checker.getCliOptions(['--unknown']),
    /未知選項：--unknown/
  );
  assert.throws(
    () => checker.getCliOptions(['/tmp/one.json', '/tmp/two.json']),
    /只能指定一個 auth\.json 路徑/
  );
}

async function testResetCliOptions() {
  const requestId = '8ae96ff3-3425-4f4c-8772-b6fd61502868';
  const resetOption = checker.getCliOptions(['--reset', '--auth', '/tmp/auth.json']);
  const retryOption = checker.getCliOptions([
    `--reset=${requestId.toUpperCase()}`,
    '/tmp/retry-auth.json',
  ]);
  const forceOption = checker.getCliOptions([
    '--reset',
    '--force',
    '--auth',
    '/tmp/force-auth.json',
  ]);
  const forceRetryOption = checker.getCliOptions([
    `--reset=${requestId}`,
    '--force',
    '/tmp/force-retry-auth.json',
  ]);

  assert.deepStrictEqual(resetOption, {
    authPath: '/tmp/auth.json',
    json: false,
    watch: false,
    reset: true,
    resetRequestId: null,
    force: false,
    timeFormat: 'local',
    exactTime: false,
  });
  assert.deepStrictEqual(retryOption, {
    authPath: '/tmp/retry-auth.json',
    json: false,
    watch: false,
    reset: true,
    resetRequestId: requestId,
    force: false,
    timeFormat: 'local',
    exactTime: false,
  });
  assert.deepStrictEqual(forceOption, {
    authPath: '/tmp/force-auth.json',
    json: false,
    watch: false,
    reset: true,
    resetRequestId: null,
    force: true,
    timeFormat: 'local',
    exactTime: false,
  });
  assert.deepStrictEqual(forceRetryOption, {
    authPath: '/tmp/force-retry-auth.json',
    json: false,
    watch: false,
    reset: true,
    resetRequestId: requestId,
    force: true,
    timeFormat: 'local',
    exactTime: false,
  });
  assert.throws(
    () => checker.getCliOptions(['--reset', '--json']),
    /--reset 不可與 --json 同時使用/
  );
  assert.throws(
    () => checker.getCliOptions(['--reset', '--watch']),
    /--reset 不可與 --watch 同時使用/
  );
  assert.throws(
    () => checker.getCliOptions(['--reset=not-a-uuid']),
    /必須是有效的 UUID/
  );
  assert.throws(
    () => checker.getCliOptions(['--reset', '--reset']),
    /--reset 只能指定一次/
  );
  assert.throws(
    () => checker.getCliOptions(['--force']),
    /--force 只能與 --reset 一起使用/
  );
  assert.throws(
    () => checker.getCliOptions(['--reset', '--force', '--force']),
    /--force 只能指定一次/
  );
}

async function testTimeFormatCliOptions() {
  const equalsOption = checker.getCliOptions(['--time-format=utc', '--auth', '/tmp/auth.json']);
  const spaceOption = checker.getCliOptions(['--time-format', 'iso', '/tmp/space-auth.json']);
  const defaultOption = checker.getCliOptions(['/tmp/auth.json']);
  const watchOption = checker.getCliOptions(['--watch', '--time-format=utc', '/tmp/auth.json']);
  const exactTimeOption = checker.getCliOptions(['--exact-time', '/tmp/auth.json']);
  const exactTimeWatchOption = checker.getCliOptions(['--watch', '--exact-time', '/tmp/auth.json']);
  const shortExactTimeOption = checker.getCliOptions(['-t', '/tmp/short-exact-auth.json']);
  const shortExactTimeWatchOption = checker.getCliOptions(['-w', '-t', '/tmp/short-exact-watch.json']);

  assert.strictEqual(equalsOption.timeFormat, 'utc');
  assert.strictEqual(spaceOption.timeFormat, 'iso');
  assert.strictEqual(defaultOption.timeFormat, 'local');
  assert.strictEqual(watchOption.timeFormat, 'utc');
  assert.strictEqual(defaultOption.exactTime, false);
  assert.strictEqual(exactTimeOption.exactTime, true);
  assert.strictEqual(exactTimeWatchOption.exactTime, true);
  assert.strictEqual(shortExactTimeOption.exactTime, true);
  assert.strictEqual(shortExactTimeWatchOption.exactTime, true);
  assert.strictEqual(shortExactTimeWatchOption.watch, true);
  assert.throws(
    () => checker.getCliOptions(['--time-format', 'cet']),
    /--time-format 只支援 local、utc 或 iso/
  );
  assert.throws(
    () => checker.getCliOptions(['--time-format']),
    /--time-format 需要指定 local、utc 或 iso/
  );
  assert.throws(
    () => checker.getCliOptions(['--time-format=utc', '--time-format', 'iso']),
    /--time-format 只能指定一次/
  );
  assert.throws(
    () => checker.getCliOptions(['--exact-time', '--exact-time']),
    /--exact-time 只能指定一次/
  );
  assert.throws(
    () => checker.getCliOptions(['-t', '--exact-time']),
    /--exact-time 只能指定一次/
  );
}

async function testExactTimeFlagRendersExactResetTime() {
  const originalLog = console.log;
  const stdout = [];
  console.log = (value = '') => stdout.push(String(value));

  try {
    const usage = checker.normalizeUsageResponse(usageResponse());
    const renderState = { row: 0, zones: [] };
    checker.renderOutput(
      { available_count: 2, credits: [] },
      usage,
      { plan_type: 'pro' },
      null,
      null,
      {
        watch: false,
        timeFormat: 'local',
        exactTime: true,
        renderState,
        beforeWatchRender: () => {
          renderState.row = 0;
          renderState.zones.length = 0;
        },
        getWatchCountdownSeconds: () => 60,
        onWatchFooterRendered: () => {},
      }
    );

    const resetLines = stdout.filter((line) => line.includes('重設時間'));
    assert.ok(resetLines.length >= 2, '應顯示多張額度卡片');
    resetLines.forEach((line) => {
      assert.match(
        line,
        /重設時間 於 \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2} 重設/,
        '預設應顯示確切時間而非倒數'
      );
      assert.ok(!line.includes('約 '), '不應顯示倒數表示法');
    });
  } finally {
    console.log = originalLog;
  }
}

async function testFormatDateTimeModes() {
  const date = new Date(Date.UTC(2026, 7, 8, 3, 52, 46));

  const localSeconds = checker.formatDateTime(date, 'local', { withSeconds: true });
  assert.match(localSeconds, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:46 [+-]\d{2}:\d{2}$/);
  const localNoSeconds = checker.formatDateTime(date, 'local', { withSeconds: false });
  assert.match(localNoSeconds, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2}$/);
  const utc = checker.formatDateTime(date, 'utc', { withSeconds: true });
  assert.strictEqual(utc, '2026-08-08 03:52:46 +00:00');
  const utcNoSeconds = checker.formatDateTime(date, 'utc', { withSeconds: false });
  assert.strictEqual(utcNoSeconds, '2026-08-08 03:52 +00:00');
  const iso = checker.formatDateTime(date, 'iso');
  assert.strictEqual(iso, '2026-08-08T03:52:46.000Z');
  assert.strictEqual(checker.formatDateTime(null, 'local'), 'N/A');
  assert.strictEqual(checker.formatDateTime('not-a-date', 'local'), 'not-a-date');
}

async function testFormatUsageResetExactTime() {
  const now = Date.now();
  const resetAt = Math.floor((now + 3600 * 1000) / 1000);
  const window = { reset_at: resetAt };

  const relative = checker.formatUsageReset(window);
  assert.match(relative, /^約 1h 後重置$/);

  const exact = checker.formatUsageReset(window, { exactTime: true, timeFormat: 'local' });
  assert.match(exact, /^於 \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2} 重置$/);

  const exactUtc = checker.formatUsageReset(window, { exactTime: true, timeFormat: 'utc' });
  assert.match(exactUtc, /^於 \d{4}-\d{2}-\d{2} \d{2}:\d{2} \+00:00 重置$/);

  const afterSeconds = checker.formatUsageReset(
    { reset_after_seconds: 5400 },
    { exactTime: true, timeFormat: 'utc' }
  );
  assert.match(afterSeconds, /^於 \d{4}-\d{2}-\d{2} \d{2}:\d{2} \+00:00 重置$/);

  const expired = checker.formatUsageReset(
    { reset_at: Math.floor(now / 1000) - 10 },
    { exactTime: true, timeFormat: 'local' }
  );
  assert.strictEqual(expired, '已到重置時間');
}

async function testExtractMouseEvents() {
  const sgr = checker.extractMouseEvents('\x1b[<0;12;5M');
  assert.deepStrictEqual(sgr.events, [{ button: 0, col: 12, row: 5, press: true }]);
  assert.strictEqual(sgr.rest, '');

  const release = checker.extractMouseEvents('\x1b[<0;12;5m');
  assert.strictEqual(release.events.length, 1);
  assert.strictEqual(release.events[0].press, false);

  const x10 = checker.extractMouseEvents('\x1b[M ,%');
  assert.deepStrictEqual(x10.events, [{ button: 0, col: 12, row: 5, press: true }]);

  const multiple = checker.extractMouseEvents('\x1b[<1;3;4M\x1b[<0;9;9M');
  assert.strictEqual(multiple.events.length, 2);
  assert.deepStrictEqual(multiple.events[1], { button: 0, col: 9, row: 9, press: true });

  const partial = checker.extractMouseEvents('\x1b[<0;12');
  assert.deepStrictEqual(partial.events, []);
  assert.strictEqual(partial.rest, '\x1b[<0;12');

  const withKeys = checker.extractMouseEvents('\x1b[<0;12;5Mq');
  assert.strictEqual(withKeys.events.length, 1);
  assert.strictEqual(withKeys.rest, 'q');
}

async function testWatchRefreshesOnIntervalAndTerminalResize() {
  const output = new EventEmitter();
  const signalEmitter = new EventEmitter();
  const writes = [];
  const refreshEvents = [];
  const intervals = [];
  const timeouts = [];
  const clearedIntervals = [];
  const clearedTimeouts = [];
  output.columns = 120;
  output.rows = 40;
  output.write = (value) => {
    writes.push(value);
    refreshEvents.push('clear');
  };

  const watcher = checker.startWatch(
    { authPath: '/tmp/auth.json', json: false, watch: true },
    {
      output,
      input: { isTTY: false },
      signalEmitter,
      refreshFunction: async (watchOptions) => {
        refreshEvents.push('query');
        watchOptions.beforeWatchRender();
        refreshEvents.push('refresh');
      },
      setIntervalFunction: (callback, delay) => {
        intervals.push({ callback, delay });
        return 'interval-handle';
      },
      clearIntervalFunction: (handle) => clearedIntervals.push(handle),
      setTimeoutFunction: (callback, delay) => {
        timeouts.push({ callback, delay });
        return `timeout-${timeouts.length}`;
      },
      clearTimeoutFunction: (handle) => clearedTimeouts.push(handle),
    }
  );

  await watcher.ready;
  assert.deepStrictEqual(refreshEvents, ['query', 'clear', 'refresh']);
  assert.strictEqual(writes[0], '\x1b[2J\x1b[H');
  assert.strictEqual(intervals.length, 1);
  assert.strictEqual(intervals[0].delay, 60_000);

  intervals[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(refreshEvents.slice(-3), ['query', 'clear', 'refresh']);

  output.emit('resize');
  assert.strictEqual(timeouts.length, 0, '尺寸未變時不應刷新');

  output.columns = 90;
  output.emit('resize');
  assert.strictEqual(timeouts.length, 1);
  assert.strictEqual(timeouts[0].delay, 100);
  timeouts[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(refreshEvents.slice(-3), ['query', 'clear', 'refresh']);

  output.rows = 32;
  output.emit('resize');
  assert.strictEqual(timeouts.length, 2, '列數變更也應觸發刷新');

  signalEmitter.emit('SIGINT');
  assert.deepStrictEqual(clearedIntervals, ['interval-handle']);
  assert.deepStrictEqual(clearedTimeouts, ['timeout-2']);
  assert.strictEqual(output.listenerCount('resize'), 0);
  assert.strictEqual(signalEmitter.listenerCount('SIGTERM'), 0);
}

async function testWatchQueuesRefreshWithoutOverlappingOutput() {
  const output = new EventEmitter();
  const signalEmitter = new EventEmitter();
  let intervalCallback = null;
  let resolveFirstRefresh;
  let activeCalls = 0;
  let maximumActiveCalls = 0;
  let refreshCount = 0;
  output.columns = 80;
  output.rows = 24;
  output.write = () => {};

  const watcher = checker.startWatch(
    { authPath: '/tmp/auth.json', json: false, watch: true },
    {
      output,
      signalEmitter,
      refreshFunction: async () => {
        refreshCount += 1;
        activeCalls += 1;
        maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
        if (refreshCount === 1) {
          await new Promise((resolve) => {
            resolveFirstRefresh = resolve;
          });
        }
        activeCalls -= 1;
      },
      setIntervalFunction: (callback) => {
        intervalCallback = callback;
        return 1;
      },
      clearIntervalFunction: () => {},
    }
  );

  intervalCallback();
  resolveFirstRefresh();
  await watcher.ready;

  assert.strictEqual(refreshCount, 2);
  assert.strictEqual(maximumActiveCalls, 1);
  watcher.stop();
}

async function testWatchContinuesAfterRefreshFailure() {
  const output = new EventEmitter();
  const signalEmitter = new EventEmitter();
  const originalError = console.error;
  const errors = [];
  let intervalCallback = null;
  let refreshCount = 0;
  output.columns = 80;
  output.rows = 24;
  output.write = () => {};
  console.error = (value) => errors.push(String(value));

  try {
    const watcher = checker.startWatch(
      { authPath: '/tmp/auth.json', json: false, watch: true },
      {
        output,
        signalEmitter,
        refreshFunction: async () => {
          refreshCount += 1;
          if (refreshCount === 1) {
            throw new Error('暫時無法查詢');
          }
        },
        setIntervalFunction: (callback) => {
          intervalCallback = callback;
          return 1;
        },
        clearIntervalFunction: () => {},
      }
    );

    await watcher.ready;
    assert.strictEqual(refreshCount, 1);
    assert.ok(errors.some((line) => line.includes('暫時無法查詢')));

    intervalCallback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(refreshCount, 2);
    watcher.stop();
  } finally {
    console.error = originalError;
  }
}

async function testWatchCountdownAndSpacebarRefresh() {
  const output = new EventEmitter();
  const input = new EventEmitter();
  const signalEmitter = new EventEmitter();
  const writes = [];
  const intervals = [];
  const clearedIntervals = [];
  const rawModeChanges = [];
  let refreshCount = 0;
  let currentTime = 1_000_000;
  let latestWatchOptions = null;
  let paused = true;
  output.columns = 80;
  output.rows = 24;
  output.isTTY = true;
  output.write = (value) => writes.push(String(value));
  input.isTTY = true;
  input.isRaw = false;
  input.readableFlowing = null;
  input.isPaused = () => paused;
  input.setRawMode = (value) => {
    input.isRaw = value;
    rawModeChanges.push(value);
  };
  input.resume = () => {
    paused = false;
    input.readableFlowing = true;
  };
  input.pause = () => {
    paused = true;
    input.readableFlowing = false;
  };

  const watcher = checker.startWatch(
    { authPath: '/tmp/auth.json', json: false, watch: true },
    {
      output,
      input,
      signalEmitter,
      refreshFunction: async (watchOptions) => {
        refreshCount += 1;
        latestWatchOptions = watchOptions;
        watchOptions.beforeWatchRender();
        watchOptions.onWatchFooterRendered({
          lineWidth: 58,
        });
      },
      setIntervalFunction: (callback, delay) => {
        const handle = { callback, delay };
        intervals.push(handle);
        return handle;
      },
      clearIntervalFunction: (handle) => clearedIntervals.push(handle),
      nowFunction: () => currentTime,
    }
  );

  await watcher.ready;
  assert.strictEqual(refreshCount, 1);
  assert.strictEqual(latestWatchOptions.getWatchCountdownSeconds(), 60);
  assert.deepStrictEqual(rawModeChanges, [true]);
  assert.strictEqual(intervals.length, 2);

  const countdownTimer = intervals.find((item) => item.delay === 1_000);
  assert.ok(countdownTimer);
  countdownTimer.callback();
  const countdownWrite = writes[writes.length - 1];
  assert.ok(countdownWrite.includes('\x1b[1A'));
  assert.ok(countdownWrite.includes('Spacebar'));
  assert.ok(countdownWrite.includes('下次刷新'));
  assert.ok(countdownWrite.includes('秒'));
  assert.ok(countdownWrite.endsWith('\x1b8'), '倒數內容應顯示於最下方操作提示列');

  currentTime += 30_000;
  assert.strictEqual(latestWatchOptions.getWatchCountdownSeconds(), 30);
  const originalAutoRefreshTimer = intervals.find((item) => item.delay === 60_000);
  input.emit('data', Buffer.from(' '));
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(refreshCount, 2);
  assert.strictEqual(latestWatchOptions.getWatchCountdownSeconds(), 60);
  assert.strictEqual(intervals.filter((item) => item.delay === 60_000).length, 2);
  assert.ok(clearedIntervals.includes(originalAutoRefreshTimer));

  input.emit('data', Buffer.from(' q'));
  assert.deepStrictEqual(rawModeChanges, [true, false]);
  assert.strictEqual(input.listenerCount('data'), 0);
  assert.strictEqual(paused, true);
  assert.strictEqual(clearedIntervals.length, 3);
}

async function testWatchUsageZonesMatchRenderedRows() {
  const originalColumns = process.stdout.columns;
  const originalLog = console.log;
  const stdout = [];
  process.stdout.columns = 200;
  console.log = (value = '') => stdout.push(String(value));

  try {
    const usage = checker.normalizeUsageResponse(usageResponse());
    const renderState = { row: 0, zones: [] };
    checker.renderOutput(
      {
        available_count: 2,
        credits: [
          { status: 'available', granted_at: '2026-07-13T00:00:00Z', expires_at: '2026-08-13T00:00:00Z' },
          { status: 'available', granted_at: '2026-07-13T00:00:00Z', expires_at: '2026-08-13T00:00:00Z' },
          { status: 'available', granted_at: '2026-07-13T00:00:00Z', expires_at: '2026-08-13T00:00:00Z' },
          { status: 'available', granted_at: '2026-07-13T00:00:00Z', expires_at: '2026-08-13T00:00:00Z' },
        ],
      },
      usage,
      { plan_type: 'pro' },
      null,
      null,
      {
        watch: true,
        timeFormat: 'local',
        renderState,
        beforeWatchRender: () => {
          renderState.row = 0;
          renderState.zones.length = 0;
        },
        getWatchCountdownSeconds: () => 60,
        onWatchFooterRendered: () => {},
      }
    );

    const resetRows = [];
    stdout.forEach((line, index) => {
      if (line.includes('重設時間') && !line.includes('切換顯示')) {
        resetRows.push(index + 1);
      }
    });

    assert.ok(resetRows.length >= 2, '畫面上應有多個重設時間列');
    renderState.zones.forEach((zone) => {
      assert.ok(resetRows.includes(zone.row), `zone row ${zone.row} 應對應實際的重設時間列`);
    });
    assert.strictEqual(
      new Set(renderState.zones.map((zone) => zone.row)).size,
      resetRows.length,
      '每個重設時間列都應有對應的點擊命中區'
    );
  } finally {
    console.log = originalLog;
    if (originalColumns === undefined) {
      delete process.stdout.columns;
    } else {
      process.stdout.columns = originalColumns;
    }
  }
}

async function testWatchMouseClickTogglesResetTime() {  const auth = createAuthFile();
  const originalLog = console.log;
  const output = new EventEmitter();
  const input = new EventEmitter();
  const signalEmitter = new EventEmitter();
  const writes = [];
  const intervals = [];
  const clearedIntervals = [];
  const stdout = [];
  output.columns = 120;
  output.rows = 40;
  output.isTTY = true;
  output.write = (value) => writes.push(String(value));
  input.isTTY = true;
  input.isRaw = false;
  input.readableFlowing = null;
  input.isPaused = () => true;
  input.setRawMode = () => {
    input.isRaw = true;
  };
  input.resume = () => {};
  input.pause = () => {};
  console.log = (value = '') => stdout.push(String(value));

  try {
    await withFakeHttps(
      {
        '/backend-api/wham/rate-limit-reset-credits': {
          body: { available_count: 2, credits: [] },
        },
        '/backend-api/wham/usage': { body: usageResponse() },
        '/backend-api/accounts/check/v4-2023-04-27': { body: {} },
      },
      async () => {
        const watcher = checker.startWatch(
          { authPath: auth.authPath, json: false, watch: true },
          {
            output,
            input,
            signalEmitter,
            setIntervalFunction: (callback, delay) => {
              const handle = { callback, delay };
              intervals.push(handle);
              return handle;
            },
            clearIntervalFunction: (handle) => clearedIntervals.push(handle),
          }
        );

        await watcher.ready;

        assert.ok(writes.some((value) => value === '\x1b[?1000h'), '應啟用滑鼠追蹤');
        const firstRenderLength = stdout.length;
        assert.ok(stdout.some((line) => line.includes('約 2h 15m 後重設')));

        const resetLineIndex = stdout.findIndex((line) => line.includes('重設時間'));
        assert.ok(resetLineIndex >= 0, '畫面上應有重設時間行');
        const zoneRow = resetLineIndex + 1;

        input.emit('data', Buffer.from('\x1b[<0;5;1M'));
        await new Promise((resolve) => setImmediate(resolve));
        assert.strictEqual(
          stdout.length,
          firstRenderLength,
          '點擊非重設時間位置不應重繪'
        );

        input.emit('data', Buffer.from(`\x1b[<0;5;${zoneRow}M`));
        await new Promise((resolve) => setImmediate(resolve));
        const secondRender = stdout.slice(firstRenderLength);
        assert.ok(secondRender.length > 0, '點擊重設時間應重繪畫面');
        assert.ok(
          secondRender.some((line) => /^│ 重設時間 .* \d{4}-\d{2}-\d{2} \d{2}:\d{2} [+-]\d{2}:\d{2} 重設 +│$/.test(line)),
          '切換後應顯示確切當地時間'
        );
        assert.ok(
          secondRender.some((line) => line.includes('重設時間')),
          '切換後仍有重設時間行'
        );
        assert.ok(!secondRender.join('\n').includes('約 2h 15m 後重設'), '切換後不應再顯示倒數');

        const secondRenderLength = stdout.length;
        input.emit('data', Buffer.from(`\x1b[<0;5;${zoneRow}M`));
        await new Promise((resolve) => setImmediate(resolve));
        const thirdRender = stdout.slice(secondRenderLength);
        assert.ok(
          thirdRender.some((line) => line.includes('約 2h 15m 後重設')),
          '再次點擊應切回倒數顯示'
        );

        watcher.stop();
        assert.ok(writes.some((value) => value === '\x1b[?1000l'), '結束時應停用滑鼠追蹤');
      }
    );
  } finally {
    console.log = originalLog;
    auth.cleanup();
  }
}

async function testWatchHumanOutputEndsWithControls() {
  const auth = createAuthFile();
  const originalLog = console.log;
  const output = [];
  console.log = (value = '') => output.push(String(value));

  try {
    await withFakeHttps(
      {
        '/backend-api/wham/rate-limit-reset-credits': {
          body: { available_count: 2, credits: [] },
        },
        '/backend-api/wham/usage': { body: usageResponse() },
        '/backend-api/accounts/check/v4-2023-04-27': {
          body: {
            accounts: {
              default: {
                account: { account_id: 'account-id' },
                entitlement: { expires_at: '2026-08-15T00:00:00' },
              },
            },
          },
        },
      },
      async () => checker.runOnce({
        authPath: auth.authPath,
        json: false,
        watch: true,
        getWatchCountdownSeconds: () => 60,
      })
    );

    assert.ok(output.some((line) => line.includes('方案：Pro')));
    assert.ok(output.some((line) => line.includes('續約時間：2026-08-15 00:00')));
    assert.ok(output[output.length - 1].includes('Spacebar 立即刷新，q 結束監視'));
    assert.ok(output[output.length - 1].includes('點擊「重設時間」切換顯示'));
    assert.ok(output[output.length - 1].includes('下次刷新：60 秒'));
  } finally {
    console.log = originalLog;
    auth.cleanup();
  }
}

async function testRequestsReuseHeadersAndEndpoints() {
  const manualResponse = { available_count: 2, credits: [] };
  const usage = usageResponse();

  await withFakeHttps({
    '/backend-api/wham/rate-limit-reset-credits': { body: manualResponse },
    '/backend-api/wham/usage': { body: usage },
  }, async (calls) => {
    const manual = await checker.requestRateLimit('token-secret', 'account-secret');
    const currentUsage = await checker.requestUsage('token-secret', 'account-secret');

    assert.deepStrictEqual(manual, manualResponse);
    assert.deepStrictEqual(currentUsage, usage);
    assert.deepStrictEqual(calls.map((call) => call.path), [
      '/backend-api/wham/rate-limit-reset-credits',
      '/backend-api/wham/usage',
    ]);
    assert.strictEqual(calls[0].headers.Authorization, 'Bearer token-secret');
    assert.strictEqual(calls[1].headers['ChatGPT-Account-ID'], 'account-secret');
    assert.strictEqual(calls[1].headers['OpenAI-Beta'], 'codex-1');
    assert.strictEqual(calls[1].headers.originator, 'Codex Desktop');
  });
}

async function testResetSuccessPostsUuidAndRefetchesUsage() {
  const auth = createAuthFile();
  const requestId = '8ae96ff3-3425-4f4c-8772-b6fd61502868';
  const beforeUsage = usageResponse();
  const afterUsage = usageResponse();
  beforeUsage.rate_limit.primary_window.used_percent = 100;
  afterUsage.rate_limit.primary_window.used_percent = 0;

  try {
    const captured = await captureConsole(() => withFakeHttps({
      '/backend-api/wham/rate-limit-reset-credits': [
        { body: { available_count: 2, credits: [] } },
        { body: { available_count: 1, credits: [] } },
      ],
      '/backend-api/wham/usage': [
        { body: beforeUsage },
        { body: afterUsage },
      ],
      '/backend-api/wham/rate-limit-reset-credits/consume': {
        body: {
          code: 'reset',
          windows_reset: 2,
        },
      },
      '/backend-api/accounts/check/v4-2023-04-27': {
        body: {},
      },
    }, async (calls) => {
      const result = await checker.runReset(
        {
          authPath: auth.authPath,
          json: false,
          watch: false,
          reset: true,
          resetRequestId: requestId,
        },
        {
          confirmationFunction: async () => true,
        }
      );
      return {
        calls,
        result,
      };
    }));

    const consumeCall = captured.result.calls.find(
      (call) => call.path === '/backend-api/wham/rate-limit-reset-credits/consume'
    );
    assert.ok(consumeCall);
    assert.strictEqual(consumeCall.method, 'POST');
    assert.strictEqual(consumeCall.headers['Content-Type'], 'application/json');
    assert.strictEqual(
      consumeCall.headers['Content-Length'],
      Buffer.byteLength(consumeCall.body)
    );
    assert.deepStrictEqual(JSON.parse(consumeCall.body), {
      redeem_request_id: requestId,
    });
    assert.strictEqual(captured.result.result.outcome, 'reset');
    assert.strictEqual(
      captured.result.calls.filter(
        (call) => call.path === '/backend-api/wham/rate-limit-reset-credits'
      ).length,
      2
    );
    assert.strictEqual(
      captured.result.calls.filter((call) => call.path === '/backend-api/wham/usage').length,
      2
    );
    assert.ok(captured.stdout.some((line) => line.includes('後端已接受重置')));
    assert.ok(!captured.stderr.some((line) => line.includes('未觀察到用量下降')));
    assert.ok(!captured.stdout.join('\n').includes('token-secret'));
    assert.ok(!captured.stderr.join('\n').includes('account-secret'));
  } finally {
    auth.cleanup();
  }
}

async function testResetCancellationDoesNotPost() {
  const auth = createAuthFile();

  try {
    const captured = await captureConsole(() => withFakeHttps({
      '/backend-api/wham/rate-limit-reset-credits': {
        body: { available_count: 2, credits: [] },
      },
      '/backend-api/wham/usage': {
        body: usageResponse(),
      },
    }, async (calls) => {
      const result = await checker.runReset(
        {
          authPath: auth.authPath,
          json: false,
          watch: false,
          reset: true,
          resetRequestId: null,
          force: false,
        },
        {
          confirmationFunction: async () => false,
        }
      );
      return {
        calls,
        result,
      };
    }));

    assert.strictEqual(captured.result.result.outcome, 'cancelled');
    assert.ok(
      !captured.result.calls.some(
        (call) => call.path === '/backend-api/wham/rate-limit-reset-credits/consume'
      )
    );
    assert.ok(captured.stdout.some((line) => line.includes('已取消')));
  } finally {
    auth.cleanup();
  }
}

async function testForceResetSkipsConfirmationAndPosts() {
  const auth = createAuthFile();
  const requestId = '8ae96ff3-3425-4f4c-8772-b6fd61502868';
  let confirmationCalled = false;

  try {
    const captured = await captureConsole(() => withFakeHttps({
      '/backend-api/wham/rate-limit-reset-credits': [
        { body: { available_count: 2, credits: [] } },
        { body: { available_count: 1, credits: [] } },
      ],
      '/backend-api/wham/usage': [
        { body: usageResponse() },
        { body: usageResponse() },
      ],
      '/backend-api/wham/rate-limit-reset-credits/consume': {
        body: {
          code: 'reset',
          windows_reset: 1,
        },
      },
      '/backend-api/accounts/check/v4-2023-04-27': {
        body: {},
      },
    }, async (calls) => {
      const result = await checker.runReset(
        {
          authPath: auth.authPath,
          json: false,
          watch: false,
          reset: true,
          resetRequestId: requestId,
          force: true,
        },
        {
          confirmationFunction: async () => {
            confirmationCalled = true;
            return false;
          },
        }
      );
      return {
        calls,
        result,
      };
    }));

    assert.strictEqual(confirmationCalled, false);
    assert.strictEqual(captured.result.result.outcome, 'reset');
    assert.ok(
      captured.result.calls.some(
        (call) => call.path === '/backend-api/wham/rate-limit-reset-credits/consume'
      )
    );
    assert.ok(captured.stdout.some((line) => line.includes('略過互動確認')));
  } finally {
    auth.cleanup();
  }
}

async function testResetRequiresCreditsAndInteractiveConfirmation() {
  const auth = createAuthFile();
  let confirmationCalled = false;

  try {
    await assert.rejects(
      checker.runReset(
        {
          authPath: auth.authPath,
          json: false,
          watch: false,
          reset: true,
          resetRequestId: null,
          force: true,
        },
        {
          requestRateLimitFunction: async () => ({ available_count: 0 }),
          requestUsageFunction: async () => usageResponse(),
          confirmationFunction: async () => {
            confirmationCalled = true;
            return true;
          },
        }
      ),
      /目前沒有可用的手動重置額度/
    );
    assert.strictEqual(confirmationCalled, false);
    assert.throws(
      () => checker.confirmResetUsage(1, { isTTY: false }, { isTTY: true }),
      /只能在互動式終端機執行/
    );
  } finally {
    auth.cleanup();
  }
}

async function testUncertainResetFailurePreservesRequestId() {
  const auth = createAuthFile();
  const requestId = '8ae96ff3-3425-4f4c-8772-b6fd61502868';
  let consumeCalls = 0;

  try {
    await captureConsole(async () => {
      await assert.rejects(
        checker.runReset(
          {
            authPath: auth.authPath,
            json: false,
            watch: false,
            reset: true,
            resetRequestId: requestId,
          },
          {
            requestRateLimitFunction: async () => ({ available_count: 2 }),
            requestUsageFunction: async () => usageResponse(),
            confirmationFunction: async () => true,
            requestConsumeResetFunction: async () => {
              consumeCalls += 1;
              const error = new Error('請求 API 逾時');
              error.outcomeUncertain = true;
              throw error;
            },
          }
        ),
        (error) => {
          assert.match(error.message, /重置結果不明/);
          assert.match(error.message, new RegExp(`--reset=${requestId}`));
          return true;
        }
      );
    });
    assert.strictEqual(consumeCalls, 1);
  } finally {
    auth.cleanup();
  }
}

async function testResetEligibilityFailureDoesNotSuggestUncertainRetry() {
  const auth = createAuthFile();

  try {
    await captureConsole(async () => {
      await assert.rejects(
        checker.runReset(
          {
            authPath: auth.authPath,
            json: false,
            watch: false,
            reset: true,
            resetRequestId: '8ae96ff3-3425-4f4c-8772-b6fd61502868',
          },
          {
            requestRateLimitFunction: async () => ({ available_count: 1 }),
            requestUsageFunction: async () => usageResponse(),
            confirmationFunction: async () => true,
            requestConsumeResetFunction: async () => {
              const error = new Error(
                '請求 API 失敗，HTTP 403 Forbidden. 回應內容：{"detail":{"code":"rate_limit_reset_ineligible"}}'
              );
              error.statusCode = 403;
              error.outcomeUncertain = false;
              throw error;
            },
          }
        ),
        (error) => {
          assert.match(error.message, /rate_limit_reset_ineligible/);
          assert.doesNotMatch(error.message, /重置結果不明/);
          assert.doesNotMatch(error.message, /--reset=/);
          return true;
        }
      );
    });
  } finally {
    auth.cleanup();
  }
}

async function testResetNoOpOutcomesDoNotRenderSuccess() {
  const auth = createAuthFile();

  try {
    for (const [code, expectedMessage] of [
      ['nothing_to_reset', /沒有符合重置資格/],
      ['no_credit', /沒有可用的手動重置額度/],
    ]) {
      let renderCalls = 0;
      await captureConsole(async () => {
        await assert.rejects(
          checker.runReset(
            {
              authPath: auth.authPath,
              json: false,
              watch: false,
              reset: true,
              resetRequestId: '8ae96ff3-3425-4f4c-8772-b6fd61502868',
            },
            {
              requestRateLimitFunction: async () => ({ available_count: 1 }),
              requestUsageFunction: async () => usageResponse(),
              confirmationFunction: async () => true,
              requestConsumeResetFunction: async () => ({ code }),
              renderAfterFunction: async () => {
                renderCalls += 1;
                return {};
              },
            }
          ),
          expectedMessage
        );
      });
      assert.strictEqual(renderCalls, 0);
    }
  } finally {
    auth.cleanup();
  }
}

async function testResetWarnsWhenRefetchDoesNotShowChange() {
  const auth = createAuthFile();
  const beforeUsageRaw = usageResponse();
  const beforeUsage = checker.normalizeUsageResponse(beforeUsageRaw);

  try {
    const captured = await captureConsole(() => checker.runReset(
      {
        authPath: auth.authPath,
        json: false,
        watch: false,
        reset: true,
        resetRequestId: '8ae96ff3-3425-4f4c-8772-b6fd61502868',
      },
      {
        requestRateLimitFunction: async () => ({ available_count: 2 }),
        requestUsageFunction: async () => beforeUsageRaw,
        confirmationFunction: async () => true,
        requestConsumeResetFunction: async () => ({
          code: 'reset',
          windows_reset: 1,
        }),
        renderAfterFunction: async () => ({
          rateLimit: { available_count: 2 },
          usage: beforeUsage,
          usageRaw: beforeUsageRaw,
        }),
      }
    ));

    assert.ok(captured.stderr.some((line) => line.includes('未觀察到用量下降')));
    assert.ok(captured.stderr.some((line) => line.includes('額度減少')));
  } finally {
    auth.cleanup();
  }
}

async function testAlreadyRedeemedRefetchesWithoutSecondConsume() {
  const auth = createAuthFile();
  const usageRaw = usageResponse();
  let consumeCalls = 0;
  let renderCalls = 0;

  try {
    const captured = await captureConsole(() => checker.runReset(
      {
        authPath: auth.authPath,
        json: false,
        watch: false,
        reset: true,
        resetRequestId: '8ae96ff3-3425-4f4c-8772-b6fd61502868',
      },
      {
        requestRateLimitFunction: async () => ({ available_count: 1 }),
        requestUsageFunction: async () => usageRaw,
        confirmationFunction: async () => true,
        requestConsumeResetFunction: async () => {
          consumeCalls += 1;
          return { outcome: 'alreadyRedeemed' };
        },
        renderAfterFunction: async () => {
          renderCalls += 1;
          return {
            rateLimit: { available_count: 1 },
            usage: checker.normalizeUsageResponse(usageRaw),
            usageRaw,
          };
        },
      }
    ));

    assert.strictEqual(captured.result.outcome, 'already_redeemed');
    assert.strictEqual(consumeCalls, 1);
    assert.strictEqual(renderCalls, 1);
    assert.ok(captured.stdout.some((line) => line.includes('先前已完成')));
    assert.ok(!captured.stderr.some((line) => line.includes('未觀察到用量下降')));
  } finally {
    auth.cleanup();
  }
}

async function testResetOutcomeNormalizationAndUuidGeneration() {
  const requestId = '8ae96ff3-3425-4f4c-8772-b6fd61502868';
  assert.strictEqual(checker.normalizeResetOutcome({ outcome: 'alreadyRedeemed' }), 'already_redeemed');
  assert.strictEqual(checker.normalizeResetOutcome({ code: 'nothing_to_reset' }), 'nothing_to_reset');
  assert.strictEqual(checker.normalizeResetOutcome({ outcome: 'noCredit' }), 'no_credit');
  assert.strictEqual(checker.normalizeResetOutcome({ code: 'unexpected' }), null);
  assert.strictEqual(checker.createRedeemRequestId(() => requestId), requestId);
  assert.match(
    checker.createRedeemRequestId(null),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
}

async function testRequestJsonUsesWallClockDeadline() {
  let timeoutCallback = null;
  const clearedTimeouts = [];

  await withFakeHttps({
    '/never-responds': { hang: true },
  }, async () => {
    const pendingRequest = checker.requestJson(
      'https://chatgpt.com/never-responds',
      'token-secret',
      'account-secret',
      {},
      {
        setTimeoutFunction: (callback, delay) => {
          assert.strictEqual(delay, 15_000);
          timeoutCallback = callback;
          return 'deadline-handle';
        },
        clearTimeoutFunction: (handle) => clearedTimeouts.push(handle),
      }
    );

    assert.strictEqual(typeof timeoutCallback, 'function');
    timeoutCallback();
    await assert.rejects(pendingRequest, /請求 API 逾時（超過 15 秒）/);
    assert.deepStrictEqual(clearedTimeouts, ['deadline-handle']);
  });
}

async function testPostTimeoutIsMarkedAsUncertain() {
  let timeoutCallback = null;

  await withFakeHttps({
    '/backend-api/wham/rate-limit-reset-credits/consume': { hang: true },
  }, async () => {
    const pendingRequest = checker.requestJsonRequest(
      'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume',
      'token-secret',
      'account-secret',
      {
        method: 'POST',
        body: {
          redeem_request_id: '8ae96ff3-3425-4f4c-8772-b6fd61502868',
        },
      },
      {
        setTimeoutFunction: (callback) => {
          timeoutCallback = callback;
          return 'post-deadline';
        },
        clearTimeoutFunction: () => {},
      }
    );

    timeoutCallback();
    await assert.rejects(
      pendingRequest,
      (error) => {
        assert.strictEqual(error.outcomeUncertain, true);
        assert.match(error.message, /請求 API 逾時/);
        return true;
      }
    );
  });
}

async function testUsageHttpFailuresKeepManualJsonAndMaskToken() {
  const auth = createAuthFile();

  try {
    for (const statusCode of [401, 429, 500]) {
      const captured = await captureMain(
        ['--auth', auth.authPath, '--json'],
        {
          '/backend-api/wham/rate-limit-reset-credits': {
            body: { available_count: 2, credits: [] },
          },
          '/backend-api/wham/usage': {
            statusCode,
            statusMessage: statusCode === 401 ? 'Unauthorized' : 'Failure',
            body: JSON.stringify({ token: 'token-secret', account: 'account-secret' }),
          },
        }
      );

      const output = JSON.parse(captured.stdout[0]);
      assert.strictEqual(output.available_count, 2);
      assert.strictEqual(output.usage, null);
      assert.strictEqual(output.usage_raw, null);
      assert.match(output.usage_error, new RegExp(`HTTP ${statusCode}`));
      assert.ok(captured.stderr.some((line) => line.includes('使用額度查詢失敗')));
      assert.ok(!captured.stdout.join('\n').includes('token-secret'));
      assert.ok(!captured.stderr.join('\n').includes('token-secret'));
      assert.ok(!captured.stderr.join('\n').includes('account-secret'));
    }
  } finally {
    auth.cleanup();
  }
}

async function testSuccessfulJsonKeepsRawUsageAndAddsNormalizedUsage() {
  const auth = createAuthFile();
  const rawUsage = usageResponse();

  try {
    const captured = await captureMain(
      ['--auth', auth.authPath, '--json'],
      {
        '/backend-api/wham/rate-limit-reset-credits': {
          body: { available_count: 2, credits: [] },
        },
        '/backend-api/wham/usage': { body: rawUsage },
      }
    );

    const output = JSON.parse(captured.stdout[0]);
    assert.deepStrictEqual(output.usage_raw, rawUsage);
    assert.strictEqual(output.usage.primary_window.name, '目前工作階段');
    assert.strictEqual(output.usage.primary_window.used_percent, 42);
    assert.strictEqual(output.usage.primary_window.remaining_percent, 58);
    assert.strictEqual(captured.stderr.length, 0);
  } finally {
    auth.cleanup();
  }
}

async function testJsonOutputMasksSensitiveValuesFromApiResponse() {
  const auth = createAuthFile();

  try {
    const captured = await captureMain(
      ['--auth', auth.authPath, '--json'],
      {
        '/backend-api/wham/rate-limit-reset-credits': {
          body: {
            available_count: 2,
            credits: [
              {
                granted_at: '2026-07-13T00:00:00Z',
                expires_at: '2026-07-20T00:00:00Z',
                note: 'token-secret account-secret',
              },
            ],
            token: 'token-secret',
            account: 'account-secret',
          },
        },
        '/backend-api/wham/usage': { body: usageResponse() },
      }
    );

    assert.ok(!captured.stdout.join('\n').includes('token-secret'));
    assert.ok(!captured.stdout.join('\n').includes('account-secret'));
    assert.ok(captured.stdout.join('\n').includes('[已隱藏]'));
  } finally {
    auth.cleanup();
  }
}

async function testUsageFailureKeepsHumanManualOutput() {
  const auth = createAuthFile();

  try {
    const captured = await captureMain(
      ['--auth', auth.authPath],
      {
        '/backend-api/wham/rate-limit-reset-credits': {
          body: { available_count: 2, credits: [] },
        },
        '/backend-api/wham/usage': {
          statusCode: 503,
          statusMessage: 'Service Unavailable',
          body: '{}',
        },
      }
    );

    const output = captured.stdout.join('\n');
    assert.ok(output.includes('使用額度'));
    assert.ok(output.includes('使用額度資料不可用'));
    assert.ok(output.includes('手動重置額度'));
    assert.ok(!output.includes('額度清單'));
    assert.ok(!output.includes('可用額度：'));
    assert.ok(captured.stderr.some((line) => line.includes('使用額度查詢失敗')));
  } finally {
    auth.cleanup();
  }
}

async function testHumanOutputSeparatesBothCreditTypes() {
  const auth = createAuthFile();

  try {
    const captured = await captureMain(
      ['--auth', auth.authPath],
      {
        '/backend-api/wham/rate-limit-reset-credits': {
          body: {
            available_count: 2,
            credits: [],
          },
        },
        '/backend-api/wham/usage': { body: usageResponse() },
      }
    );

    const output = captured.stdout.join('\n');
    const outputLines = output.split('\n');
    const roundedBoxEdges = outputLines.filter(
      (line) => line.startsWith('╭') || line.startsWith('╰')
    );
    assert.ok(output.includes('使用額度'));
    assert.ok(outputLines[0].startsWith('╭'));
    assert.ok(output.includes('Codex 額度查詢'));
    assert.ok(roundedBoxEdges.length >= 10);
    assert.strictEqual(new Set(roundedBoxEdges.map((line) => line.length)).size, 1);
    assert.ok(output.includes('5 小時使用情況限制'));
    assert.ok(output.includes('已使用 42%'));
    assert.ok(output.includes('58% 剩餘'));
    assert.ok(output.includes('╭'));
    assert.ok(output.includes('█'));
    assert.ok(output.includes('GPT-5.3-Codex-Spark 5 小時使用情況限制'));
    assert.ok(output.includes('已使用 12%'));
    assert.ok(output.includes('GPT-5.3-Codex-Spark 每週用量上限'));
    assert.ok(output.includes('手動重置額度'));
    assert.ok(!output.includes('額度清單'));
    assert.ok(!output.includes('可用額度：'));
  } finally {
    auth.cleanup();
  }
}

const tests = [
  ['完整使用額度回應可標準化', testNormalizeCompleteUsage],
  ['只有 primary window 的每週額度可正確辨識', testNormalizeWeeklyOnlyPrimaryWindow],
  ['缺少或 null 欄位不會讓解析失敗', testNormalizeMissingAndNullWindowFields],
  ['使用額度寬度受手動重置額度限制', testUsageLayoutUsesManualResetWidthCap],
  ['單筆手動重置額度使用完整終端機寬度', testSingleManualResetUsesFullTerminalWidth],
  ['watch CLI 長短選項皆可解析', testWatchCliOptions],
  ['reset CLI 選項、冪等鍵與互斥組合可正確解析', testResetCliOptions],
  ['--time-format 選項可解析並驗證取值', testTimeFormatCliOptions],
  ['--exact-time 預設以確切時間顯示重設時間', testExactTimeFlagRendersExactResetTime],
  ['日期時間依 local/utc/iso 格式顯示', testFormatDateTimeModes],
  ['重設時間可切換為確切時間顯示', testFormatUsageResetExactTime],
  ['滑鼠事件可解析 SGR 與 X10 格式', testExtractMouseEvents],
  ['watch 每分鐘與終端機尺寸變更時刷新', testWatchRefreshesOnIntervalAndTerminalResize],
  ['watch 刷新不會重疊輸出', testWatchQueuesRefreshWithoutOverlappingOutput],
  ['watch 單次刷新失敗後仍會繼續', testWatchContinuesAfterRefreshFailure],
  ['watch 顯示倒數、Spacebar 無空白等待刷新並可以 q 結束', testWatchCountdownAndSpacebarRefresh],
  ['watch 滑鼠點擊重設時間可在倒數與確切時間間切換', testWatchMouseClickTogglesResetTime],
  ['watch 點擊命中區對應實際重設時間列', testWatchUsageZonesMatchRenderedRows],
  ['watch 輸出最後一行顯示操作提示', testWatchHumanOutputEndsWithControls],
  ['兩個端點共用標頭且路徑正確', testRequestsReuseHeadersAndEndpoints],
  ['reset 成功時以 POST 傳送 UUID 並重新查詢', testResetSuccessPostsUuidAndRefetchesUsage],
  ['reset 取消時不會送出 POST', testResetCancellationDoesNotPost],
  ['reset --force 會略過確認並直接送出 POST', testForceResetSkipsConfirmationAndPosts],
  ['reset 與 --force 都需要可用額度，互動模式需要 TTY', testResetRequiresCreditsAndInteractiveConfirmation],
  ['reset 結果不明時保留原 UUID 且不自動重試', testUncertainResetFailurePreservesRequestId],
  ['reset eligibility 失敗不會誤導為結果不明', testResetEligibilityFailureDoesNotSuggestUncertainRetry],
  ['reset 無可重置視窗或額度時不顯示成功', testResetNoOpOutcomesDoNotRenderSuccess],
  ['reset 後重新查詢未變時會顯示警告', testResetWarnsWhenRefetchDoesNotShowChange],
  ['already redeemed 會重新查詢且不再次消耗', testAlreadyRedeemedRefetchesWithoutSecondConsume],
  ['reset 回應與 UUID 產生可正確標準化', testResetOutcomeNormalizationAndUuidGeneration],
  ['API 請求使用固定 15 秒牆鐘期限', testRequestJsonUsesWallClockDeadline],
  ['POST 逾時會標記為重置結果不明', testPostTimeoutIsMarkedAsUncertain],
  ['使用額度 HTTP 錯誤仍保留手動額度並遮罩敏感值', testUsageHttpFailuresKeepManualJsonAndMaskToken],
  ['JSON 同時保留標準化與原始使用額度', testSuccessfulJsonKeepsRawUsageAndAddsNormalizedUsage],
  ['JSON API 回應中的敏感值會被遮罩', testJsonOutputMasksSensitiveValuesFromApiResponse],
  ['使用額度失敗時仍顯示人類可讀的手動額度', testUsageFailureKeepsHumanManualOutput],
  ['終端輸出分開顯示兩類額度', testHumanOutputSeparatesBothCreditTypes],
];

async function run() {
  for (const [name, test] of tests) {
    await test();
    process.stdout.write(`ok - ${name}\n`);
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
