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
  const originalRequest = https.request;

  https.request = (options, callback) => {
    calls.push(options);
    const responseConfig = responses[options.path] || responses.default;
    const request = new EventEmitter();

    request.end = () => {
      if (!responseConfig) {
        request.emit('error', new Error(`沒有測試回應：${options.path}`));
        return;
      }

      if (responseConfig.error) {
        request.emit('error', responseConfig.error);
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

async function testWatchCliOptions() {
  const longOption = checker.getCliOptions(['--watch', '--auth', '/tmp/auth.json']);
  const shortOption = checker.getCliOptions(['-w', '/tmp/short-auth.json']);

  assert.deepStrictEqual(longOption, {
    authPath: '/tmp/auth.json',
    json: false,
    watch: true,
  });
  assert.deepStrictEqual(shortOption, {
    authPath: '/tmp/short-auth.json',
    json: false,
    watch: true,
  });
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

  input.emit('data', Buffer.from('q'));
  assert.deepStrictEqual(rawModeChanges, [true, false]);
  assert.strictEqual(input.listenerCount('data'), 0);
  assert.strictEqual(paused, true);
  assert.strictEqual(clearedIntervals.length, 3);
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
    assert.ok(output[output.length - 1].includes('Spacebar 立即刷新，q 結束監視。'));
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
  ['watch CLI 長短選項皆可解析', testWatchCliOptions],
  ['watch 每分鐘與終端機尺寸變更時刷新', testWatchRefreshesOnIntervalAndTerminalResize],
  ['watch 刷新不會重疊輸出', testWatchQueuesRefreshWithoutOverlappingOutput],
  ['watch 單次刷新失敗後仍會繼續', testWatchContinuesAfterRefreshFailure],
  ['watch 顯示倒數、Spacebar 無空白等待刷新並可以 q 結束', testWatchCountdownAndSpacebarRefresh],
  ['watch 輸出最後一行顯示操作提示', testWatchHumanOutputEndsWithControls],
  ['兩個端點共用標頭且路徑正確', testRequestsReuseHeadersAndEndpoints],
  ['使用額度 HTTP 錯誤仍保留手動額度並遮罩敏感值', testUsageHttpFailuresKeepManualJsonAndMaskToken],
  ['JSON 同時保留標準化與原始使用額度', testSuccessfulJsonKeepsRawUsageAndAddsNormalizedUsage],
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
