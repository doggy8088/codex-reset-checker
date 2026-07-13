#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const RATE_LIMIT_API_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';
const USAGE_API_URL = 'https://chatgpt.com/backend-api/wham/usage';

const COLOR = process.stdout && process.stdout.isTTY && !process.env.NO_COLOR;
const CREDIT_WIDTH = 54;
const CREDIT_GAP = 2;
const WATCH_INTERVAL_MS = 60_000;
const RESIZE_DEBOUNCE_MS = 100;
const APP_VERSION = (() => {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg && typeof pkg.version === 'string' ? pkg.version : 'N/A';
  } catch {
    return 'N/A';
  }
})();

const STYLE = COLOR
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m',
    }
  : {
      reset: '',
      bold: '',
      dim: '',
      green: '',
      yellow: '',
      red: '',
      blue: '',
      magenta: '',
      cyan: '',
      gray: '',
    };

function paint(style, text) {
  return `${STYLE[style] || ''}${text}${STYLE.reset}`;
}

function printUsage() {
  console.log(`用法：
  node ./bin/codex-reset-checker.js [auth.json 路徑]

選項：
  --auth <path>   指定 auth.json 路徑（未提供則依作業系統自動判斷）
  --json          以單行 JSON 輸出查詢結果與標準化使用額度
  -w, --watch     持續監看；Spacebar 刷新，q 結束
  -h, --help      顯示說明`);
}

function getCliOptions(cliArgs) {
  let authPath = null;
  let json = false;
  let watch = false;

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--watch' || arg === '-w') {
      watch = true;
      continue;
    }

    if (arg === '--auth' && cliArgs[i + 1]) {
      authPath = cliArgs[i + 1];
      i += 1;
      continue;
    }

    if (!arg.startsWith('-') && !authPath) {
      authPath = arg;
    }
  }

  if (authPath) {
    return { authPath, json, watch };
  }

  const home = process.platform === 'win32'
    ? process.env.USERPROFILE || os.homedir()
    : os.homedir();

  return {
    authPath: path.join(home, '.codex', 'auth.json'),
    json,
    watch,
  };
}

function pad(number) {
  return String(number).padStart(2, '0');
}

function formatShortDate(value) {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function compactRemaining(expireValue) {
  if (!expireValue) {
    return {
      text: 'N/A',
      color: 'yellow',
      icon: '[缺]',
      vibe: '時間缺漏',
    };
  }

  const expireDate = new Date(expireValue);
  if (Number.isNaN(expireDate.getTime())) {
    return {
      text: '時間異常',
      color: 'yellow',
      icon: '[異]',
      vibe: '欄位格式怪怪的',
    };
  }

  const now = new Date();
  let diff = expireDate.getTime() - now.getTime();
  const isExpired = diff < 0;
  diff = Math.abs(diff);

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}m`);
  }

  if (isExpired) {
    return {
      text: `到期已過 ${parts.join(' ')}`,
      color: 'red',
      icon: '[破]',
      vibe: '請稍後刷新',
    };
  }

  if (days === 0 && hours === 0) {
    return {
      text: `剩餘 ${parts.join(' ')}`,
      color: minutes <= 15 ? 'red' : 'yellow',
      icon: minutes <= 15 ? '[危]' : '[緊]',
      vibe: minutes <= 15 ? '先慢一點' : '準備補位',
    };
  }

  if (days === 0) {
    return {
      text: `剩餘 ${parts.join(' ')}`,
      color: 'yellow',
      icon: '[警]',
      vibe: '提醒自己排程',
    };
  }

  return {
    text: `剩餘 ${parts.join(' ')}`,
    color: 'green',
    icon: '[充足]',
    vibe: '時間充足',
  };
}

function formatLocalTime(value) {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const tzHour = pad(Math.floor(absoluteOffset / 60));
  const tzMinute = pad(absoluteOffset % 60);
  const tzString = `${sign}${tzHour}:${tzMinute}`;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${tzString}`;
}

function humanizeRemaining(expireValue) {
  if (!expireValue) {
    return '剩餘時間：未提供';
  }

  const expireDate = new Date(expireValue);
  if (Number.isNaN(expireDate.getTime())) {
    return '剩餘時間：無法解析';
  }

  const now = new Date();
  let diff = expireDate.getTime() - now.getTime();

  const isExpired = diff < 0;
  diff = Math.abs(diff);

  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts = [];
  if (days > 0) {
    parts.push(`${days} 天`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours} 小時`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} 分鐘`);
  }

  const text = parts.join(' ');
  return isExpired ? `剩餘時間：已過期 ${text}` : `剩餘時間：剩餘 ${text}`;
}

function loadAuth(authPath) {
  if (!fs.existsSync(authPath)) {
    throw new Error(`找不到 auth.json：${authPath}`);
  }

  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`讀取或解析 auth.json 失敗：${error.message}`);
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeSensitiveText(value, sensitiveValues = []) {
  let text = String(value);

  for (const sensitiveValue of sensitiveValues) {
    if (sensitiveValue === null || sensitiveValue === undefined) {
      continue;
    }

    const secret = String(sensitiveValue);
    if (secret) {
      text = text.split(secret).join('[已隱藏]');
    }
  }

  return text.replace(/(Bearer\s+)[^\s"'`,}]+/gi, '$1[已隱藏]');
}

function getErrorMessage(error) {
  if (error && typeof error.message === 'string' && error.message) {
    return error.message;
  }

  return String(error || '未知錯誤');
}

function buildApiHeaders(accessToken, accountId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'codex-1',
    originator: 'Codex Desktop',
  };

  if (accountId) {
    headers['ChatGPT-Account-ID'] = String(accountId);
  }

  return headers;
}

function formatResponseBody(body, sensitiveValues) {
  if (!body) {
    return '';
  }

  const sanitized = sanitizeSensitiveText(body, sensitiveValues);
  const maxLength = 1000;
  const shortened = sanitized.length > maxLength
    ? `${sanitized.slice(0, maxLength)}…`
    : sanitized;

  return ` 回應內容：${shortened}`;
}

function requestJson(apiUrl, accessToken, accountId, additionalHeaders = {}) {
  const headers = {
    ...buildApiHeaders(accessToken, accountId),
    ...additionalHeaders,
  };
  const sensitiveValues = [accessToken, accountId];
  const endpoint = new URL(apiUrl);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: endpoint.hostname,
        path: endpoint.pathname + endpoint.search,
        headers,
      },
      (res) => {
        let chunks = '';

        res.on('data', (chunk) => {
          chunks += chunk.toString('utf8');
        });

        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const message = formatResponseBody(chunks, sensitiveValues);
            reject(new Error(`請求 API 失敗，HTTP ${res.statusCode} ${res.statusMessage}.${message}`));
            return;
          }

          try {
            resolve(JSON.parse(chunks));
          } catch (error) {
            reject(new Error(`回應 JSON 解析失敗：${error.message}`));
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(new Error(`請求 API 失敗：${error.message}`));
    });

    req.end();
  });
}

function requestRateLimit(accessToken, accountId) {
  return requestJson(RATE_LIMIT_API_URL, accessToken, accountId);
}

function requestUsage(accessToken, accountId) {
  return requestJson(USAGE_API_URL, accessToken, accountId);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }

  if (typeof value === 'string' && value.trim() === '') {
    return null;
  }

  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundNumber(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function normalizePercent(value) {
  const number = toFiniteNumber(value);
  if (number === null) {
    return null;
  }

  return roundNumber(Math.min(100, Math.max(0, number)));
}

function normalizeNonNegativeNumber(value) {
  const number = toFiniteNumber(value);
  if (number === null) {
    return null;
  }

  return Math.max(0, roundNumber(number));
}

function normalizeResetAt(value) {
  const number = toFiniteNumber(value);
  if (number !== null) {
    return Math.floor(Math.abs(number) > 100000000000 ? number / 1000 : number);
  }

  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return Math.floor(timestamp / 1000);
    }
  }

  return null;
}

function inferUsageWindowName(window, fallbackName) {
  if (!isObject(window)) {
    return fallbackName;
  }

  const seconds = normalizeNonNegativeNumber(window.limit_window_seconds);
  if (seconds !== null) {
    if (seconds >= 6 * 24 * 60 * 60) {
      return '每週額度';
    }

    if (seconds <= 6 * 60 * 60) {
      return '目前工作階段';
    }
  }

  return fallbackName;
}

function normalizeUsageWindow(window, fallbackName) {
  const source = isObject(window) ? window : {};
  const usedPercent = normalizePercent(source.used_percent);

  return {
    name: inferUsageWindowName(source, fallbackName),
    used_percent: usedPercent,
    remaining_percent: usedPercent === null ? null : roundNumber(100 - usedPercent),
    limit_window_seconds: normalizeNonNegativeNumber(source.limit_window_seconds),
    reset_after_seconds: normalizeNonNegativeNumber(source.reset_after_seconds),
    reset_at: normalizeResetAt(source.reset_at),
  };
}

function getFirstValue(source, keys) {
  if (!isObject(source)) {
    return null;
  }

  for (const key of keys) {
    if (source[key] !== null && source[key] !== undefined) {
      return source[key];
    }
  }

  return null;
}

function getAdditionalRateLimitCollection(response) {
  const candidates = [
    response.additional_rate_limits,
    response.rate_limit && response.rate_limit.additional_rate_limits,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }

    if (isObject(candidate)) {
      return Object.entries(candidate).map(([key, value]) => {
        if (!isObject(value)) {
          return value;
        }

        return {
          ...value,
          limit_name: getFirstValue(value, ['limit_name', 'name', 'id']) || key,
        };
      });
    }
  }

  return [];
}

function getAdditionalRateLimitWindow(limit, windowKey) {
  const candidates = [
    limit,
    isObject(limit) && isObject(limit.rate_limit) ? limit.rate_limit : null,
    isObject(limit) && isObject(limit.rateLimit) ? limit.rateLimit : null,
  ];
  const camelKey = windowKey === 'primary_window' ? 'primaryWindow' : 'secondaryWindow';

  for (const candidate of candidates) {
    const window = getFirstValue(candidate, [windowKey, camelKey]);
    if (isObject(window)) {
      return window;
    }
  }

  return null;
}

function getAdditionalRateLimitDirectWindow(limit) {
  if (!isObject(limit)) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(limit, 'used_percent')) {
    return limit;
  }

  if (isObject(limit.window)) {
    return limit.window;
  }

  if (isObject(limit.rate_limit) && Object.prototype.hasOwnProperty.call(limit.rate_limit, 'used_percent')) {
    return limit.rate_limit;
  }

  return null;
}

function normalizeAdditionalRateLimitName(value, id) {
  const rawName = value === null || value === undefined ? '' : String(value);
  const identity = `${id} ${rawName}`.toLowerCase();

  if (identity.includes('spark')) {
    return 'GPT-5.3-Codex-Spark';
  }

  return rawName || id;
}

function normalizeAdditionalRateLimits(response) {
  return getAdditionalRateLimitCollection(response)
    .map((limit, index) => {
      if (!isObject(limit)) {
        return null;
      }

      const rawId = getFirstValue(limit, ['limit_name', 'metered_limit_name', 'name', 'id']);
      const id = rawId === null || rawId === undefined || rawId === ''
        ? `additional-${index + 1}`
        : String(rawId);
      const name = normalizeAdditionalRateLimitName(
        getFirstValue(limit, ['display_name', 'title', 'name', 'limit_name', 'metered_limit_name']),
        id
      );
      const identity = `${id} ${name}`.toLowerCase();
      const isWeekly = identity.includes('weekly') || identity.includes('secondary');
      const directWindow = getAdditionalRateLimitDirectWindow(limit);
      let primarySource = getAdditionalRateLimitWindow(limit, 'primary_window');
      let secondarySource = getAdditionalRateLimitWindow(limit, 'secondary_window');

      if (!primarySource && !secondarySource && directWindow) {
        if (isWeekly) {
          secondarySource = directWindow;
        } else {
          primarySource = directWindow;
        }
      }

      return {
        id,
        name,
        primary_window: primarySource
          ? normalizeUsageWindow(primarySource, '目前工作階段')
          : null,
        secondary_window: secondarySource
          ? normalizeUsageWindow(secondarySource, '每週額度')
          : null,
      };
    })
    .filter(Boolean);
}

function normalizeUsageResponse(response) {
  if (!isObject(response) || !isObject(response.rate_limit)) {
    throw new Error('使用額度 API 回傳格式非預期：缺少 rate_limit');
  }

  return {
    primary_window: isObject(response.rate_limit.primary_window)
      ? normalizeUsageWindow(response.rate_limit.primary_window, '目前工作階段')
      : null,
    secondary_window: isObject(response.rate_limit.secondary_window)
      ? normalizeUsageWindow(response.rate_limit.secondary_window, '每週額度')
      : null,
    additional_rate_limits: normalizeAdditionalRateLimits(response),
  };
}

function formatPercent(value) {
  return value === null || value === undefined ? 'N/A' : `${value}%`;
}

function formatCompactDurationFromSeconds(seconds) {
  let totalMinutes = Math.floor(Math.max(0, seconds) / 60);
  if (totalMinutes === 0 && seconds > 0) {
    totalMinutes = 1;
  }

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0 || days > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}m`);
  }

  return parts.join(' ');
}

function getUsageResetSeconds(window) {
  if (!isObject(window)) {
    return null;
  }

  if (window.reset_at !== null && window.reset_at !== undefined) {
    return window.reset_at - Math.floor(Date.now() / 1000);
  }

  if (window.reset_after_seconds !== null && window.reset_after_seconds !== undefined) {
    return window.reset_after_seconds;
  }

  return null;
}

function formatUsageReset(window) {
  const seconds = getUsageResetSeconds(window);
  if (seconds === null) {
    return '重置時間：未提供';
  }

  if (seconds <= 0) {
    return '已到重置時間';
  }

  return `約 ${formatCompactDurationFromSeconds(seconds)} 後重置`;
}

function getUsageColor(usedPercent) {
  if (usedPercent === null || usedPercent === undefined) {
    return 'yellow';
  }

  if (usedPercent >= 90) {
    return 'red';
  }

  if (usedPercent >= 75) {
    return 'yellow';
  }

  return 'green';
}

const USAGE_CARD_WIDTH = 42;
const USAGE_BAR_WIDTH = 28;
const USAGE_CARD_GAP = 2;

function getCurrentTerminalWidth() {
  if (!process.stdout) {
    return 0;
  }

  const columns = Number(process.stdout.columns);
  return Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 0;
}

function getTerminalSize(output = process.stdout) {
  const normalizeDimension = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  };

  return {
    columns: output ? normalizeDimension(output.columns) : 0,
    rows: output ? normalizeDimension(output.rows) : 0,
  };
}

function terminalSizeChanged(previous, current) {
  return previous.columns !== current.columns || previous.rows !== current.rows;
}

function clearTerminal(output = process.stdout) {
  if (output && typeof output.write === 'function') {
    output.write('\x1b[2J\x1b[H');
  }
}

function buildUsageProgressBar(remainingPercent, width = USAGE_BAR_WIDTH, color = 'green') {
  if (remainingPercent === null || remainingPercent === undefined) {
    return paint('gray', '─'.repeat(width));
  }

  const filledWidth = Math.round((width * remainingPercent) / 100);
  return `${paint(color, '█'.repeat(filledWidth))}${paint(
    'gray',
    '░'.repeat(Math.max(0, width - filledWidth))
  )}`;
}

function getUsageCardTitle(label, windowType) {
  const suffix = windowType === 'primary' ? '5 小時使用情況限制' : '每週用量上限';

  if (label === '目前工作階段' || label === '每週額度') {
    return suffix;
  }

  return `${label} ${suffix}`;
}

function centerText(value, width) {
  const text = String(value);
  const padding = Math.max(0, width - textDisplayWidth(text));
  const leftPadding = Math.floor(padding / 2);
  const rightPadding = padding - leftPadding;
  return `${' '.repeat(leftPadding)}${text}${' '.repeat(rightPadding)}`;
}

function buildRoundedBoxLines(contentLines, contentWidth) {
  const safeWidth = Math.max(
    contentWidth,
    ...contentLines.map((line) => textDisplayWidth(line))
  );
  const top = `╭${'─'.repeat(safeWidth + 2)}╮`;
  const bottom = `╰${'─'.repeat(safeWidth + 2)}╯`;
  const body = contentLines.map((line) => {
    const text = String(line);
    const padding = Math.max(0, safeWidth - textDisplayWidth(text));
    return `│ ${text}${' '.repeat(padding)} │`;
  });

  return [paint('bold', top), ...body, paint('bold', bottom)];
}

function buildUsageCardLines(title, window, contentWidth = USAGE_CARD_WIDTH) {
  const color = getUsageColor(window.used_percent);
  const remaining = formatPercent(window.remaining_percent);
  const used = formatPercent(window.used_percent);
  const reset = formatUsageReset(window)
    .replace(/^重置時間：/, '')
    .replace(/重置$/, '重設');
  const contentLines = [
    paint('dim', title),
    `${paint(color, remaining)} ${paint('dim', '剩餘')} ${paint('gray', `・已使用 ${used}`)}`,
    buildUsageProgressBar(
      window.remaining_percent,
      Math.max(USAGE_BAR_WIDTH, contentWidth),
      color
    ),
    `${paint('dim', '重設時間')} ${paint('gray', reset)}`,
  ];
  return buildRoundedBoxLines(contentLines, contentWidth);
}

function getUsageLayout(cards, maxTotalWidth = 0) {
  const terminalWidth = getCurrentTerminalWidth();
  const naturalCardWidth = Math.max(
    USAGE_CARD_WIDTH,
    ...cards.map((card) => textDisplayWidth(card.title))
  );
  const availableWidth = maxTotalWidth > 0
    ? terminalWidth > 0
      ? Math.min(terminalWidth, maxTotalWidth)
      : maxTotalWidth
    : terminalWidth;

  if (!availableWidth) {
    return {
      cardContentWidth: naturalCardWidth,
      boxContentWidth: naturalCardWidth,
      terminalWidth: 0,
      twoColumns: false,
    };
  }

  const twoColumnContentWidth = Math.floor(
    (availableWidth - USAGE_CARD_GAP - 8) / 2
  );
  if (cards.length >= 2 && twoColumnContentWidth >= naturalCardWidth) {
    return {
      cardContentWidth: twoColumnContentWidth,
      boxContentWidth: availableWidth - 4,
      terminalWidth: availableWidth,
      twoColumns: true,
    };
  }

  return {
    cardContentWidth: Math.max(1, availableWidth - 4),
    boxContentWidth: availableWidth - 4,
    terminalWidth: availableWidth,
    twoColumns: false,
  };
}

function printUsageCards(cards, layout = getUsageLayout(cards)) {
  const normalizedCards = cards.map((card) => ({
    lines: buildUsageCardLines(card.title, card.window, layout.cardContentWidth),
  }));

  if (layout.twoColumns) {
    printCreditCardsInTwoColumns(
      normalizedCards,
      layout.terminalWidth,
      layout.cardContentWidth,
      USAGE_CARD_GAP
    );
    return;
  }

  printCreditCardsInSingleColumn(normalizedCards);
}

function getUsageCards(usage) {
  if (!usage) {
    return [];
  }

  const cards = [];
  if (usage.primary_window) {
    cards.push({
      title: getUsageCardTitle(
        usage.primary_window.name,
        usage.primary_window.name === '每週額度' ? 'secondary' : 'primary'
      ),
      window: usage.primary_window,
    });
  }
  if (usage.secondary_window) {
    cards.push({
      title: getUsageCardTitle(usage.secondary_window.name, 'secondary'),
      window: usage.secondary_window,
    });
  }

  const additionalRateLimits = Array.isArray(usage.additional_rate_limits)
    ? usage.additional_rate_limits
    : [];
  additionalRateLimits.forEach((limit) => {
    if (limit.primary_window) {
      cards.push({
        title: getUsageCardTitle(
          limit.name,
          limit.primary_window.name === '每週額度' ? 'secondary' : 'primary'
        ),
        window: limit.primary_window,
      });
    }
    if (limit.secondary_window) {
      cards.push({
        title: getUsageCardTitle(limit.name, 'secondary'),
        window: limit.secondary_window,
      });
    }
  });

  return cards;
}

function printUsageSection(usage, layout) {
  console.log(paint('bold', '使用額度'));

  const cards = getUsageCards(usage);
  if (!cards.length) {
    console.log('- 使用額度資料不可用');
    return;
  }

  printUsageCards(cards, layout || getUsageLayout(cards));
}

function parseStatusMood(status) {
  const normalized = (status || '').toString().toLowerCase();

  if (!normalized) {
    return {
      icon: '[-]',
      tone: '資料不完整',
      color: 'yellow',
    };
  }

  if (normalized === 'available') {
    return {
      icon: '[可用]',
      tone: '',
      color: 'green',
    };
  }

  if (normalized.includes('active')) {
    return {
      icon: '[可用]',
      tone: '仍在有效',
      color: 'green',
    };
  }

  if (normalized.includes('used') || normalized.includes('consumed')) {
    return {
      icon: '[已用]',
      tone: '已用盡',
      color: 'gray',
    };
  }

  if (normalized.includes('expired')) {
    return {
      icon: '[過期]',
      tone: '已過期',
      color: 'red',
    };
  }

  if (normalized.includes('pending')) {
    return {
      icon: '[待審核]',
      tone: '狀態待確',
      color: 'blue',
    };
  }

  return {
    icon: '[未知]',
    tone: '未知狀態',
    color: 'magenta',
  };
}

function buildCreditLine(prefix, content, width = CREDIT_WIDTH) {
  const text = `${prefix}${String(content || '')}`;
  const visibleLen = textDisplayWidth(text);
  const padding = Math.max(0, width - visibleLen);
  return `│ ${text}${' '.repeat(padding)} │`;
}

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '');
}

function textDisplayWidth(value) {
  const text = stripAnsi(String(value));
  let width = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    const isWideChar =
      (codePoint >= 0x1100 && codePoint <= 0x115f) ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x20000 && codePoint <= 0x2fffd) ||
      (codePoint >= 0x30000 && codePoint <= 0x3fffd);
    width += isWideChar ? 2 : 1;
  }

  return width;
}

function getCreditCardLines(index, credit) {
  const mood = parseStatusMood(credit.status);
  const grantedAt = formatShortDate(credit.granted_at);
  const expiresAt = formatShortDate(credit.expires_at);
  const remaining = compactRemaining(credit.expires_at);
  const idx = String(index + 1).padStart(3, '0');
  const status = credit.status != null ? credit.status : 'N/A';
  const statusLine = `${paint(mood.color, mood.icon)} ${paint('dim', `status=${status}`)}${
    mood.tone ? ` ${paint(mood.color, mood.tone)}` : ''
  }`;
  const lines = [
    paint('cyan', `#${idx}`),
    statusLine,
    `${paint(remaining.color, remaining.icon)} ${paint(remaining.color, remaining.text)}`,
    `${paint('dim', '[期限]')} ${paint('dim', '獲得')} ${paint('blue', grantedAt)}  ${paint('dim', '到期')} ${paint(
      'blue',
      expiresAt
    )}`,
  ];

  return lines;
}

function buildCreditCardLines(lines, contentWidth = CREDIT_WIDTH) {
  const safeWidth = Math.max(contentWidth, CREDIT_WIDTH, ...lines.map((item) => textDisplayWidth(item)));
  const top = `┌${'─'.repeat(safeWidth + 2)}┐`;
  const bottom = `└${'─'.repeat(safeWidth + 2)}┘`;

  return [
    paint('bold', top),
    ...lines.map((line) => buildCreditLine(' ', line, safeWidth)),
    paint('bold', bottom),
  ];
}

function printCreditCardsInSingleColumn(cards) {
  cards.forEach((card) => {
    card.lines.forEach((line) => {
      console.log(line);
    });
  });
}

function printCreditCardsInTwoColumns(cards, terminalWidth, cardWidth, gap = CREDIT_GAP) {
  const cardOuterWidth = cardWidth + 4;
  const canTwoColumns = cards.length >= 2 && terminalWidth >= cardOuterWidth * 2 + gap;

  if (!canTwoColumns) {
    return false;
  }

  const cardLines = cards.map((card) => card.lines);
  const rowHeight = Math.max(...cardLines.map((item) => item.length));

  for (let i = 0; i < cardLines.length; i += 2) {
    const left = cardLines[i];
    const right = cardLines[i + 1] || null;

    for (let row = 0; row < rowHeight; row += 1) {
      const leftLine = left[row] || '';
      const rightLine = right ? right[row] : '';
      const columnGap = right ? ' '.repeat(gap) : '';
      console.log(`${leftLine}${columnGap}${rightLine}`);
    }
  }

  return true;
}

function getWatchCountdownSeconds(nextRefreshAt, now = Date.now()) {
  return Math.max(0, Math.ceil((nextRefreshAt - now) / 1000));
}

function formatPlanName(planType) {
  if (typeof planType !== 'string' || !planType.trim()) {
    return 'N/A';
  }

  const normalized = planType.trim().toLowerCase();
  const knownPlans = {
    free: 'Free',
    plus: 'Plus',
    pro: 'Pro 20x',
    prolite: 'Pro 5x',
    team: 'Team',
    business: 'Business',
    enterprise: 'Enterprise',
    edu: 'Edu',
  };

  return knownPlans[normalized] || normalized
    .split(/[-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatRenewalTime(expiresAt) {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') {
    return 'N/A';
  }

  const numericValue = Number(expiresAt);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue > 1_000_000_000_000 ? numericValue : numericValue * 1000)
    : new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function getSubscriptionExpiresAt(accountStatus, accountId) {
  if (!isObject(accountStatus)) {
    return null;
  }

  if (isObject(accountStatus.account_plan)) {
    return accountStatus.account_plan.subscription_expires_at_timestamp ?? null;
  }

  if (!isObject(accountStatus.accounts)) {
    return null;
  }

  const accountEntries = Object.values(accountStatus.accounts).filter(isObject);
  const matchingAccount = accountEntries.find((entry) =>
    isObject(entry.account) && entry.account.account_id === accountId
  );
  const defaultAccount = isObject(accountStatus.accounts.default)
    ? accountStatus.accounts.default
    : null;
  const selectedAccount = matchingAccount || defaultAccount || accountEntries[0];

  return isObject(selectedAccount) && isObject(selectedAccount.entitlement)
    ? selectedAccount.entitlement.expires_at ?? null
    : null;
}

function buildHeaderDetailLines(nowText, contentWidth, accountInfo = {}) {
  const queryTime = `${paint('dim', '查詢時間')}：${paint('cyan', nowText)}`;
  const plan = `${paint('dim', '方案')}：${paint('cyan', formatPlanName(accountInfo.planType))}`;
  const renewal = `${paint('dim', '續約時間')}：${paint('cyan', formatRenewalTime(accountInfo.renewalAt))}`;
  const accountSummary = `${plan}  ${renewal}`;
  const inlinePadding = contentWidth - textDisplayWidth(queryTime) - textDisplayWidth(accountSummary);

  if (inlinePadding >= 1) {
    return [`${queryTime}${' '.repeat(inlinePadding)}${accountSummary}`];
  }

  const summaryPadding = Math.max(0, contentWidth - textDisplayWidth(accountSummary));
  return [queryTime, `${' '.repeat(summaryPadding)}${accountSummary}`];
}

function buildWatchControlsLine(countdownSeconds, lineWidth) {
  const controls = paint('dim', 'Spacebar 立即刷新，q 結束監視。');
  if (countdownSeconds === null || countdownSeconds === undefined) {
    return controls;
  }

  const countdown = `${paint('dim', '下次刷新')}：${paint('cyan', `${countdownSeconds} 秒`)}`;
  const padding = Math.max(2, lineWidth - textDisplayWidth(controls) - textDisplayWidth(countdown));
  return `${controls}${' '.repeat(padding)}${countdown}`;
}

function printHeader(contentWidth = null, watchOptions = {}) {
  const now = new Date();
  const tzOffsetMinutes = -now.getTimezoneOffset();
  const sign = tzOffsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(tzOffsetMinutes);
  const nowText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const terminalWidth = getCurrentTerminalWidth();
  const resolvedContentWidth = contentWidth ||
    (terminalWidth ? Math.max(1, terminalWidth - 4) : USAGE_CARD_WIDTH);
  const title = centerText(
    paint('bold', `Codex 額度查詢 (v${APP_VERSION})`),
    resolvedContentWidth
  );
  const detailLines = buildHeaderDetailLines(nowText, resolvedContentWidth, watchOptions);
  const headerContentWidth = Math.max(
    resolvedContentWidth,
    ...detailLines.map((line) => textDisplayWidth(line))
  );
  const lines = buildRoundedBoxLines(
    [
      centerText(paint('bold', `Codex 額度查詢 (v${APP_VERSION})`), headerContentWidth),
      ...detailLines,
    ],
    headerContentWidth
  );

  lines.forEach((line) => console.log(line));
}

function printManualResetSection(credits, layout) {
  console.log(paint('bold', '手動重置額度'));
  printCredits(credits, layout);
}

function prepareCreditCards(credits) {
  const prepared = (Array.isArray(credits) ? credits : [])
    .map((credit, index) => {
      if (!credit || typeof credit !== 'object') {
        return null;
      }

      const lines = getCreditCardLines(index, credit);
      const contentWidth = Math.max(CREDIT_WIDTH, ...lines.map((item) => textDisplayWidth(item)));
      return {
        lines,
        width: contentWidth,
      };
    })
    .filter(Boolean);

  if (!prepared.length) {
    return {
      cards: [],
      contentWidth: CREDIT_WIDTH,
    };
  }

  const maxContentWidth = Math.max(...prepared.map((item) => item.width));
  return {
    cards: prepared.map((item) => ({
      lines: buildCreditCardLines(item.lines, maxContentWidth),
    })),
    contentWidth: maxContentWidth,
  };
}

function getManualResetLayout(credits) {
  const prepared = prepareCreditCards(credits);
  const terminalWidth = getCurrentTerminalWidth();
  const cardOuterWidth = prepared.contentWidth + 4;
  const twoColumns =
    prepared.cards.length >= 2 && terminalWidth >= cardOuterWidth * 2 + CREDIT_GAP;
  const totalWidth = twoColumns
    ? cardOuterWidth * 2 + CREDIT_GAP
    : cardOuterWidth;

  return {
    ...prepared,
    terminalWidth,
    twoColumns,
    totalWidth,
    boxContentWidth: totalWidth - 4,
  };
}

function printCredits(credits, layout = getManualResetLayout(credits)) {
  if (!layout.cards.length) {
    return;
  }

  if (layout.twoColumns) {
    printCreditCardsInTwoColumns(layout.cards, layout.terminalWidth, layout.contentWidth);
    return;
  }

  printCreditCardsInSingleColumn(layout.cards);
}

async function runOnce(options) {
  const authPath = options.authPath;
  const auth = loadAuth(authPath);

  const tokens = auth && typeof auth === 'object' && auth.tokens ? auth.tokens : {};
  const accessToken = tokens.access_token;
  const accountId = tokens.account_id;

  if (!accessToken) {
    throw new Error('auth.json 內未找到 tokens.access_token');
  }

  const [rateLimitRequest, usageRequest, accountRequest] = await Promise.allSettled([
    requestRateLimit(accessToken, accountId),
    requestUsage(accessToken, accountId),
    requestJson(
      'https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27',
      accessToken,
      accountId,
      {
        Accept: 'application/json',
        Origin: 'https://chatgpt.com',
        Referer: 'https://chatgpt.com/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36',
      }
    ),
  ]);

  if (rateLimitRequest.status === 'rejected') {
    const message = sanitizeSensitiveText(getErrorMessage(rateLimitRequest.reason), [
      accessToken,
      accountId,
    ]);
    throw new Error(message);
  }

  const result = rateLimitRequest.value;
  if (!result || typeof result !== 'object') {
    throw new Error('API 回傳格式非預期');
  }

  let usage = null;
  let usageRaw = null;
  let usageError = null;

  if (usageRequest.status === 'fulfilled') {
    usageRaw = usageRequest.value;
    try {
      usage = normalizeUsageResponse(usageRequest.value);
    } catch (error) {
      usageError = error;
    }
  } else {
    usageError = usageRequest.reason;
  }
  const accountStatus = accountRequest.status === 'fulfilled' ? accountRequest.value : null;

  if (typeof options.beforeWatchRender === 'function') {
    options.beforeWatchRender();
  }

  if (usageError) {
    const message = sanitizeSensitiveText(getErrorMessage(usageError), [accessToken, accountId]);
    if (options.json) {
      console.error(paint('yellow', `警告：使用額度查詢失敗，仍顯示手動重置額度。${message}`));
    }
  }

  if (options.json) {
    const output = {
      ...result,
      usage,
      usage_raw: usageRaw,
    };

    if (usageError) {
      output.usage_error = sanitizeSensitiveText(getErrorMessage(usageError), [
        accessToken,
        accountId,
      ]);
    }

    console.log(JSON.stringify(output));
    return;
  }

  const credits = Array.isArray(result.credits)
    ? result.credits
    : Array.isArray(result.items)
      ? result.items
      : Array.isArray(result.data)
        ? result.data
        : [];

  const manualResetLayout = getManualResetLayout(credits);
  const usageCards = getUsageCards(usage);
  const usageLayout = getUsageLayout(usageCards, manualResetLayout.totalWidth);

  printHeader(usageLayout.boxContentWidth, {
    planType: usageRaw && typeof usageRaw === 'object' ? usageRaw.plan_type : null,
    renewalAt: getSubscriptionExpiresAt(accountStatus, accountId),
  });
  if (usageError) {
    const message = sanitizeSensitiveText(getErrorMessage(usageError), [accessToken, accountId]);
    console.error(paint('yellow', `警告：使用額度查詢失敗，仍顯示手動重置額度。${message}`));
  }
  printUsageSection(usage, usageLayout);
  console.log('');
  printManualResetSection(credits, manualResetLayout);
  if (options.watch) {
    console.log('');
    const countdownSeconds = typeof options.getWatchCountdownSeconds === 'function'
      ? options.getWatchCountdownSeconds()
      : null;
    const lineWidth = usageLayout.boxContentWidth + 4;
    const controlsLine = buildWatchControlsLine(countdownSeconds, lineWidth);
    console.log(controlsLine);
    if (typeof options.onWatchFooterRendered === 'function') {
      options.onWatchFooterRendered({
        lineWidth: Math.max(lineWidth, textDisplayWidth(controlsLine)),
      });
    }
  }
}

function startWatch(options, dependencies = {}) {
  const output = dependencies.output || process.stdout;
  const input = dependencies.input || process.stdin;
  const signalEmitter = dependencies.signalEmitter || process;
  const refreshFunction = dependencies.refreshFunction || ((watchOptions) => runOnce({
    ...options,
    ...watchOptions,
  }));
  const setIntervalFunction = dependencies.setIntervalFunction || setInterval;
  const clearIntervalFunction = dependencies.clearIntervalFunction || clearInterval;
  const setTimeoutFunction = dependencies.setTimeoutFunction || setTimeout;
  const clearTimeoutFunction = dependencies.clearTimeoutFunction || clearTimeout;
  const nowFunction = dependencies.nowFunction || Date.now;
  const intervalMs = dependencies.intervalMs || WATCH_INTERVAL_MS;
  const resizeDebounceMs = dependencies.resizeDebounceMs === undefined
    ? RESIZE_DEBOUNCE_MS
    : dependencies.resizeDebounceMs;
  let previousSize = getTerminalSize(output);
  let intervalHandle = null;
  let resizeTimeoutHandle = null;
  let activeRefresh = null;
  let refreshPending = false;
  let stopped = false;
  let nextRefreshAt = nowFunction() + intervalMs;
  let footerState = null;
  let countdownIntervalHandle = null;
  let inputWasRaw = false;
  let inputWasFlowing = false;
  let rawModeChanged = false;
  let inputFlowingChanged = false;

  const getCountdownSeconds = () => getWatchCountdownSeconds(nextRefreshAt, nowFunction());

  const renderCountdown = () => {
    if (stopped || activeRefresh || !footerState || !output || typeof output.write !== 'function') {
      return;
    }

    const line = buildWatchControlsLine(getCountdownSeconds(), footerState.lineWidth);
    output.write(`\x1b7\x1b[1A\x1b[2K${line}\x1b8`);
  };

  const refresh = () => {
    if (stopped) {
      return Promise.resolve();
    }

    if (activeRefresh) {
      refreshPending = true;
      return activeRefresh;
    }

    activeRefresh = (async () => {
      do {
        refreshPending = false;
        headerState = null;
        let screenPrepared = false;
        const prepareScreen = () => {
          if (!screenPrepared) {
            clearTerminal(output);
            screenPrepared = true;
          }
        };

        try {
          await refreshFunction({
            beforeWatchRender: prepareScreen,
            getWatchCountdownSeconds: getCountdownSeconds,
            onWatchFooterRendered: (state) => {
              footerState = state;
            },
          });
        } catch (error) {
          prepareScreen();
          console.error(paint('red', `錯誤：刷新失敗：${getErrorMessage(error)}`));
        }
      } while (refreshPending && !stopped);
    })().finally(() => {
      activeRefresh = null;
    });

    return activeRefresh;
  };

  const handleResize = () => {
    const currentSize = getTerminalSize(output);
    if (!terminalSizeChanged(previousSize, currentSize)) {
      return;
    }

    previousSize = currentSize;
    headerState = null;
    if (resizeTimeoutHandle !== null) {
      clearTimeoutFunction(resizeTimeoutHandle);
    }
    resizeTimeoutHandle = setTimeoutFunction(() => {
      resizeTimeoutHandle = null;
      void refresh();
    }, resizeDebounceMs);
  };

  const startAutoRefreshTimer = () => {
    intervalHandle = setIntervalFunction(() => {
      nextRefreshAt = nowFunction() + intervalMs;
      void refresh();
    }, intervalMs);
  };

  const resetAutoRefreshTimer = () => {
    nextRefreshAt = nowFunction() + intervalMs;
    if (intervalHandle !== null) {
      clearIntervalFunction(intervalHandle);
    }
    startAutoRefreshTimer();
  };

  const stop = () => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (intervalHandle !== null) {
      clearIntervalFunction(intervalHandle);
    }
    if (countdownIntervalHandle !== null) {
      clearIntervalFunction(countdownIntervalHandle);
    }
    if (resizeTimeoutHandle !== null) {
      clearTimeoutFunction(resizeTimeoutHandle);
    }
    if (output && typeof output.removeListener === 'function') {
      output.removeListener('resize', handleResize);
    }
    if (signalEmitter && typeof signalEmitter.removeListener === 'function') {
      signalEmitter.removeListener('SIGINT', handleSignal);
      signalEmitter.removeListener('SIGTERM', handleSignal);
    }
    if (input && typeof input.removeListener === 'function') {
      input.removeListener('data', handleInput);
    }
    if (rawModeChanged && input && typeof input.setRawMode === 'function') {
      input.setRawMode(inputWasRaw);
    }
    if (inputFlowingChanged && input && typeof input.pause === 'function') {
      input.pause();
    }
  };

  const handleSignal = () => {
    stop();
    if (output && typeof output.write === 'function') {
      output.write('\n');
    }
  };

  const handleInput = (chunk) => {
    const value = String(chunk);
    if (value.includes('\u0003') || value.includes('q')) {
      handleSignal();
      return;
    }

    if (value.includes(' ')) {
      resetAutoRefreshTimer();
      void refresh();
    }
  };

  if (output && typeof output.on === 'function') {
    output.on('resize', handleResize);
  }
  if (signalEmitter && typeof signalEmitter.once === 'function') {
    signalEmitter.once('SIGINT', handleSignal);
    signalEmitter.once('SIGTERM', handleSignal);
  }
  if (input && input.isTTY && typeof input.on === 'function') {
    inputWasRaw = Boolean(input.isRaw);
    inputWasFlowing = input.readableFlowing === true;
    if (typeof input.setRawMode === 'function' && !inputWasRaw) {
      input.setRawMode(true);
      rawModeChanged = true;
    }
    input.on('data', handleInput);
    if (!inputWasFlowing && typeof input.resume === 'function') {
      input.resume();
      inputFlowingChanged = true;
    }
  }

  startAutoRefreshTimer();
  if (!options.json && output && output.isTTY) {
    countdownIntervalHandle = setIntervalFunction(renderCountdown, 1_000);
  }

  return {
    ready: refresh(),
    refresh,
    stop,
  };
}

async function main() {
  const options = getCliOptions(process.argv.slice(2));
  if (options.watch) {
    const watcher = startWatch(options);
    await watcher.ready;
    return;
  }

  await runOnce(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(paint('red', `錯誤：${getErrorMessage(error)}`));
    process.exitCode = 1;
  });
}

module.exports = {
  buildApiHeaders,
  buildRoundedBoxLines,
  formatCompactDurationFromSeconds,
  formatUsageReset,
  getCliOptions,
  getWatchCountdownSeconds,
  getCurrentTerminalWidth,
  getManualResetLayout,
  getTerminalSize,
  getUsageCards,
  getUsageLayout,
  main,
  normalizeUsageResponse,
  normalizeUsageWindow,
  requestJson,
  requestRateLimit,
  requestUsage,
  runOnce,
  sanitizeSensitiveText,
  startWatch,
  terminalSizeChanged,
};
