'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');

const ICS_ADVANCE_MS = 3 * 24 * 60 * 60 * 1000;
const ICS_PRODID = '-//codex-reset-checker//Manual Reset Credits//ZH-TW';

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

function getEligibleCredits(credits, now = Date.now()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowTime = nowDate.getTime();

  if (Number.isNaN(nowTime)) {
    throw new Error('無法判斷目前時間');
  }

  return (Array.isArray(credits) ? credits : [])
    .map((credit, originalIndex) => {
      if (!credit || typeof credit !== 'object') {
        return null;
      }

      const status = String(credit.status || '').trim().toLowerCase();
      if (status !== 'active' && status !== 'available') {
        return null;
      }

      const expiresAt = new Date(credit.expires_at);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= nowTime) {
        return null;
      }

      return {
        credit,
        originalIndex,
        expiresAt,
        eventAt: new Date(expiresAt.getTime() - ICS_ADVANCE_MS),
      };
    })
    .filter(Boolean);
}

function formatIcsDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('無法產生 iCalendar 時間');
  }

  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function takeUtf8Prefix(value, maxBytes) {
  let byteLength = 0;
  let charLength = 0;

  for (const char of value) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (byteLength + charBytes > maxBytes) {
      break;
    }

    byteLength += charBytes;
    charLength += char.length;
  }

  return {
    head: value.slice(0, charLength),
    tail: value.slice(charLength),
  };
}

function foldIcsLine(value) {
  const folded = [];
  let remaining = String(value);
  let firstLine = true;

  do {
    const prefix = firstLine ? '' : ' ';
    const chunk = takeUtf8Prefix(remaining, 75 - Buffer.byteLength(prefix, 'utf8'));
    folded.push(`${prefix}${chunk.head}`);
    remaining = chunk.tail;
    firstLine = false;
  } while (remaining);

  return folded.join('\r\n');
}

function buildCreditUid(entry) {
  const source = `${entry.originalIndex}|${entry.expiresAt.toISOString()}`;
  const digest = crypto.createHash('sha256').update(source).digest('hex').slice(0, 24);
  return `${digest}@codex-reset-checker`;
}

function buildIcsCalendar(entries, options = {}) {
  const generatedAt = options.generatedAt instanceof Date
    ? options.generatedAt
    : new Date(options.generatedAt === undefined ? Date.now() : options.generatedAt);
  const sensitiveValues = options.sensitiveValues || [];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  entries.forEach((entry) => {
    const index = String(entry.originalIndex + 1).padStart(3, '0');
    const summary = sanitizeSensitiveText(
      `Codex 手動重置額度 #${index}`,
      sensitiveValues
    );
    const description = sanitizeSensitiveText([
      `狀態: ${entry.credit.status == null ? 'N/A' : entry.credit.status}`,
      `產生時間: ${entry.credit.granted_at == null ? 'N/A' : entry.credit.granted_at}`,
      `過期時間: ${entry.credit.expires_at == null ? 'N/A' : entry.credit.expires_at}`,
      `行事曆時間: ${entry.eventAt.toISOString()}`,
    ].join('\n'), sensitiveValues);

    lines.push(
      'BEGIN:VEVENT',
      `UID:${buildCreditUid(entry)}`,
      `DTSTAMP:${formatIcsDateTime(generatedAt)}`,
      `DTSTART:${formatIcsDateTime(entry.eventAt)}`,
      `DTEND:${formatIcsDateTime(entry.expiresAt)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      'TRANSP:TRANSPARENT',
      'SEQUENCE:0',
      'END:VEVENT'
    );
  });

  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

function formatIcsFilenameTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('無法產生 iCalendar 檔名');
  }

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function resolveIcsOutputPath(outputPath, options = {}) {
  const cwd = options.cwd || process.cwd();
  const now = options.now instanceof Date
    ? options.now
    : new Date(options.now === undefined ? Date.now() : options.now);
  const existsSyncFunction = options.existsSyncFunction || fs.existsSync;
  const statSyncFunction = options.statSyncFunction || fs.statSync;
  const resolvedPath = outputPath
    ? path.resolve(cwd, outputPath)
    : path.join(cwd, `codex-reset-credits-${formatIcsFilenameTimestamp(now)}.ics`);

  if (path.extname(resolvedPath).toLowerCase() !== '.ics') {
    throw new Error(`輸出檔案必須使用 .ics 副檔名：${resolvedPath}`);
  }

  const parentDirectory = path.dirname(resolvedPath);
  if (!existsSyncFunction(parentDirectory)) {
    throw new Error(`輸出資料夾不存在：${parentDirectory}`);
  }

  if (!statSyncFunction(parentDirectory).isDirectory()) {
    throw new Error(`輸出路徑的父層不是資料夾：${parentDirectory}`);
  }

  return resolvedPath;
}

function renderCreditSelection(entries, cursorIndex, selectedIndexes, message, output) {
  const lines = [
    '選擇要匯出的手動重置額度',
    '方向鍵移動，Space 選取，Enter 匯出，q/Esc 取消。',
    '',
  ];

  entries.forEach((entry, index) => {
    const cursor = index === cursorIndex ? '>' : ' ';
    const selected = selectedIndexes.has(index) ? '[x]' : '[ ]';
    const creditIndex = String(entry.originalIndex + 1).padStart(3, '0');
    lines.push(
      `${cursor} ${selected} #${creditIndex}  status=${entry.credit.status}  ` +
      `到期時間 ${formatShortDate(entry.expiresAt)}  ` +
      `行事曆提醒時間 ${formatShortDate(entry.eventAt)}`
    );
  });

  if (message) {
    lines.push('', message);
  }

  output.write(`\x1b[2J\x1b[H${lines.join('\n')}\n`);
}

function selectCreditsInteractively(entries, dependencies = {}) {
  const input = dependencies.input || process.stdin;
  const output = dependencies.output || process.stdout;

  if (!input || !input.isTTY || !output || !output.isTTY) {
    throw new Error('--ics 需要互動式終端機');
  }

  if (typeof input.setRawMode !== 'function') {
    throw new Error('目前終端機不支援互動複選');
  }

  return new Promise((resolve) => {
    const selectedIndexes = new Set();
    const inputWasRaw = Boolean(input.isRaw);
    const inputWasFlowing = input.readableFlowing === true;
    let cursorIndex = 0;
    let rawModeChanged = false;
    let inputFlowingChanged = false;
    let finished = false;

    const cleanup = () => {
      if (finished) {
        return;
      }

      finished = true;
      input.removeListener('data', handleInput);
      if (rawModeChanged) {
        input.setRawMode(inputWasRaw);
      }
      if (inputFlowingChanged && typeof input.pause === 'function') {
        input.pause();
      }
      output.write('\x1b[?25h\n');
    };

    const finish = (value) => {
      cleanup();
      resolve(value);
    };

    const handleInput = (chunk) => {
      const value = String(chunk);

      if (value.includes('\u0003') || value === 'q' || value === 'Q' || value === '\u001b') {
        finish(null);
        return;
      }

      if (value.includes('\u001b[A')) {
        cursorIndex = (cursorIndex - 1 + entries.length) % entries.length;
        renderCreditSelection(entries, cursorIndex, selectedIndexes, '', output);
        return;
      }

      if (value.includes('\u001b[B')) {
        cursorIndex = (cursorIndex + 1) % entries.length;
        renderCreditSelection(entries, cursorIndex, selectedIndexes, '', output);
        return;
      }

      if (value.includes(' ')) {
        if (selectedIndexes.has(cursorIndex)) {
          selectedIndexes.delete(cursorIndex);
        } else {
          selectedIndexes.add(cursorIndex);
        }
        renderCreditSelection(entries, cursorIndex, selectedIndexes, '', output);
        return;
      }

      if (value.includes('\r') || value.includes('\n')) {
        if (!selectedIndexes.size) {
          renderCreditSelection(
            entries,
            cursorIndex,
            selectedIndexes,
            '請至少選取一筆額度，或按 q 取消。',
            output
          );
          return;
        }

        finish(entries.filter((entry, index) => selectedIndexes.has(index)));
      }
    };

    if (!inputWasRaw) {
      input.setRawMode(true);
      rawModeChanged = true;
    }
    output.write('\x1b[?25l');
    input.on('data', handleInput);
    if (!inputWasFlowing && typeof input.resume === 'function') {
      input.resume();
      inputFlowingChanged = true;
    }
    renderCreditSelection(entries, cursorIndex, selectedIndexes, '', output);
  });
}

function writeIcsFile(filePath, content, dependencies = {}) {
  const writeFileFunction = dependencies.writeFileFunction || fs.promises.writeFile;

  return writeFileFunction(filePath, content, {
    encoding: 'utf8',
    flag: 'wx',
  }).catch((error) => {
    if (error && error.code === 'EEXIST') {
      throw new Error(`輸出檔案已存在，未覆寫：${filePath}`);
    }

    throw error;
  });
}

function getOpenFolderCommand(platform = process.platform) {
  if (platform === 'darwin') {
    return { command: 'open', args: [] };
  }

  if (platform === 'win32') {
    return { command: 'explorer.exe', args: [] };
  }

  if (platform === 'linux') {
    return { command: 'xdg-open', args: [] };
  }

  throw new Error(`不支援自動開啟資料夾的平台：${platform}`);
}

function openFolder(folderPath, dependencies = {}) {
  const platform = dependencies.platform || process.platform;
  const execFileFunction = dependencies.execFileFunction || childProcess.execFile;
  const opener = getOpenFolderCommand(platform);

  return new Promise((resolve, reject) => {
    execFileFunction(
      opener.command,
      [...opener.args, folderPath],
      { windowsHide: true },
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      }
    );
  });
}

async function exportCreditsToIcs(credits, options = {}, dependencies = {}) {
  const nowFunction = dependencies.nowFunction || (() => new Date());
  const nowValue = nowFunction();
  const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
  const cwd = dependencies.cwd || process.cwd();
  const logFunction = dependencies.logFunction || console.log;
  const warnFunction = dependencies.warnFunction || console.error;
  const selectCreditsFunction =
    dependencies.selectCreditsFunction || selectCreditsInteractively;
  const outputPath = resolveIcsOutputPath(options.outputPath, {
    cwd,
    now,
    existsSyncFunction: dependencies.existsSyncFunction,
    statSyncFunction: dependencies.statSyncFunction,
  });
  const eligibleCredits = getEligibleCredits(credits, now);

  if (!dependencies.selectCreditsFunction) {
    const input = dependencies.input || process.stdin;
    const output = dependencies.output || process.stdout;
    if (!input || !input.isTTY || !output || !output.isTTY) {
      throw new Error('--ics 需要互動式終端機');
    }
  }

  if (!eligibleCredits.length) {
    logFunction('沒有有效且未到期的手動重置額度可匯出。');
    return null;
  }

  const selectedCredits = await selectCreditsFunction(eligibleCredits, {
    input: dependencies.input,
    output: dependencies.output,
  });

  if (!selectedCredits || !selectedCredits.length) {
    logFunction('已取消 iCalendar 匯出。');
    return null;
  }

  const content = buildIcsCalendar(selectedCredits, {
    generatedAt: now,
    sensitiveValues: options.sensitiveValues,
  });
  await writeIcsFile(outputPath, content, {
    writeFileFunction: dependencies.writeFileFunction,
  });
  logFunction(`已產生 iCalendar 檔案：${outputPath}`);

  try {
    const openFolderFunction = dependencies.openFolderFunction || openFolder;
    await openFolderFunction(path.dirname(outputPath), {
      platform: dependencies.platform,
      execFileFunction: dependencies.execFileFunction,
    });
  } catch (error) {
    warnFunction(`警告：無法自動開啟輸出資料夾。${getErrorMessage(error)}`);
  }

  return {
    filePath: outputPath,
    selectedCount: selectedCredits.length,
  };
}

module.exports = {
  buildIcsCalendar,
  escapeIcsText,
  exportCreditsToIcs,
  foldIcsLine,
  formatIcsDateTime,
  getEligibleCredits,
  getOpenFolderCommand,
  openFolder,
  resolveIcsOutputPath,
  selectCreditsInteractively,
  writeIcsFile,
};
