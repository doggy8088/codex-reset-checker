#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const API_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

function printUsage() {
  console.log(`用法：
  node ./bin/codex-reset-checker.js [auth.json 路徑]

選項：
  --auth <path>   指定 auth.json 路徑（未提供則依作業系統自動判斷）
  -h, --help      顯示說明`);
}

function getAuthPath(cliArgs) {
  let authPath = null;

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
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
    return authPath;
  }

  const home = process.platform === 'win32'
    ? process.env.USERPROFILE || os.homedir()
    : os.homedir();

  return path.join(home, '.codex', 'auth.json');
}

function pad(number) {
  return String(number).padStart(2, '0');
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

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${tzString}`;
}

function loadAuth(authPath) {
  if (!fs.existsSync(authPath)) {
    console.error(`錯誤：找不到 auth.json：${authPath}`);
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(authPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    console.error(`錯誤：讀取或解析 auth.json 失敗：${error.message}`);
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

async function main() {
  const args = process.argv.slice(2);
  const authPath = getAuthPath(args);
  const auth = loadAuth(authPath);

  const tokens = auth && typeof auth === 'object' && auth.tokens ? auth.tokens : {};
  const accessToken = tokens.access_token;
  const accountId = tokens.account_id;

  if (!accessToken) {
    console.error('錯誤：auth.json 內未找到 tokens.access_token');
    process.exit(1);
  }

  let result;
  try {
    result = await requestRateLimit(accessToken, accountId);
  } catch (error) {
    console.error(`錯誤：${error.message}`);
    process.exit(1);
  }

  if (!result || typeof result !== 'object') {
    console.error('錯誤：API 回傳格式非預期');
    process.exit(1);
  }

  const availableCount = Object.prototype.hasOwnProperty.call(result, 'available_count')
    ? result.available_count
    : 'N/A';
  console.log(`available_count: ${availableCount}`);

  const credits = Array.isArray(result.credits)
    ? result.credits
    : Array.isArray(result.items)
      ? result.items
      : Array.isArray(result.data)
        ? result.data
        : [];

  if (!credits.length) {
    console.log('credits: 0');
    return;
  }

  console.log('credits:');
  credits.forEach((credit, index) => {
    if (!credit || typeof credit !== 'object') {
      return;
    }

    const grantedAt = formatLocalTime(credit.granted_at);
    const expiresAt = formatLocalTime(credit.expires_at);
    const status = credit.status != null ? credit.status : 'N/A';

    console.log(`- credit #${index + 1}`);
    console.log(`  granted_at: ${grantedAt}`);
    console.log(`  expires_at: ${expiresAt}`);
    console.log(`  status: ${status}`);
  });
}

main();
