#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const API_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

const COLOR = process.stdout && process.stdout.isTTY && !process.env.NO_COLOR;
const CREDIT_WIDTH = 54;
const CREDIT_GAP = 2;
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
  --json          以單行 JSON 輸出原始查詢結果
  -h, --help      顯示說明`);
}

function getCliOptions(cliArgs) {
  let authPath = null;
  let json = false;

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
    return { authPath, json };
  }

  const home = process.platform === 'win32'
    ? process.env.USERPROFILE || os.homedir()
    : os.homedir();

  return {
    authPath: path.join(home, '.codex', 'auth.json'),
    json,
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
    console.error(paint('red', `錯誤：找不到 auth.json：${authPath}`));
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(paint('red', `錯誤：讀取或解析 auth.json 失敗：${error.message}`));
    process.exit(1);
  }
}

function requestRateLimit(accessToken, accountId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'codex-1',
    originator: 'Codex Desktop',
  };

  if (accountId) {
    headers['ChatGPT-Account-ID'] = String(accountId);
  }

  const endpoint = new URL(API_URL);

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
            const message = chunks ? ` 回應內容：${chunks}` : '';
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

function parseAvailableMood(availableCount) {
  const count = Number.parseInt(availableCount, 10);
  if (!Number.isFinite(count)) {
    return { icon: '[未定義]', mood: '目前看不清楚剩餘狀態', color: 'yellow', emoji: '' };
  }

  if (count <= 0) {
    return { icon: '[告急]', mood: '目前已經是空白線，建議觀察新配額到來', color: 'red' };
  }

  if (count <= 2) {
    return { icon: '[偏緊張]', mood: '快要進入極限，建議盡快規劃下一筆額度', color: 'yellow' };
  }

  return { icon: '[穩定]', mood: '目前充足，維持節奏即可', color: 'green' };
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

function printCreditCardsInTwoColumns(cards, terminalWidth, cardWidth) {
  const cardOuterWidth = cardWidth + 4;
  const canTwoColumns = cards.length >= 2 && terminalWidth >= cardOuterWidth * 2 + CREDIT_GAP;

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
      const gap = right ? ' '.repeat(CREDIT_GAP) : '';
      console.log(`${leftLine}${gap}${rightLine}`);
    }
  }

  return true;
}

function printHeader(availableCount, availableColor) {
  const now = new Date();
  const tzOffsetMinutes = -now.getTimezoneOffset();
  const sign = tzOffsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(tzOffsetMinutes);
  const nowText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;

  console.log(paint('bold', `┏━ Codex 手動重置額度查詢 (v${APP_VERSION}) ━━━━━━━━━━━━━━━━━━`));
  console.log(`${paint('dim', '查詢時間')}：${paint('cyan', nowText)}`);
  const count = Number.parseInt(availableCount, 10);
  const hasAvailableCount = Number.isFinite(count);
  const availableLabel = hasAvailableCount ? '可用額度' : '可用資料';
  const availableText = hasAvailableCount
    ? `${paint(availableColor || 'yellow', count)}${paint('dim', ' 次')}`
    : paint(availableColor || 'yellow', availableCount);
  console.log(`${paint('dim', availableLabel)}：${availableText}`);
  console.log(paint('bold', '┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
}

function printCredits(credits) {
  if (!credits.length) {
    return;
  }

  const prepared = credits
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
    return;
  }

  const maxContentWidth = Math.max(...prepared.map((item) => item.width));
  const cards = prepared.map((item) => ({
    lines: buildCreditCardLines(item.lines, maxContentWidth),
  }));
  const terminalWidth =
    process.stdout && process.stdout.isTTY && typeof process.stdout.columns === 'number'
      ? process.stdout.columns
      : 0;
  if (printCreditCardsInTwoColumns(cards, terminalWidth, maxContentWidth)) {
    return;
  }

  printCreditCardsInSingleColumn(cards);
}

async function main() {
  const args = process.argv.slice(2);
  const options = getCliOptions(args);
  const authPath = options.authPath;
  const auth = loadAuth(authPath);

  const tokens = auth && typeof auth === 'object' && auth.tokens ? auth.tokens : {};
  const accessToken = tokens.access_token;
  const accountId = tokens.account_id;

  if (!accessToken) {
    console.error(paint('red', '錯誤：auth.json 內未找到 tokens.access_token'));
    process.exit(1);
  }

  let result;
  try {
    result = await requestRateLimit(accessToken, accountId);
  } catch (error) {
    console.error(paint('red', `錯誤：${error.message}`));
    process.exit(1);
  }

  if (!result || typeof result !== 'object') {
    console.error(paint('red', '錯誤：API 回傳格式非預期'));
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify(result));
    return;
  }

  const availableCount = Object.prototype.hasOwnProperty.call(result, 'available_count')
    ? result.available_count
    : 'N/A';
  const countMood = parseAvailableMood(availableCount);

  printHeader(availableCount, countMood.color);
  const credits = Array.isArray(result.credits)
    ? result.credits
    : Array.isArray(result.items)
      ? result.items
      : Array.isArray(result.data)
        ? result.data
        : [];
  console.log(paint('dim', '額度清單'));
  printCredits(credits);
}

main();
