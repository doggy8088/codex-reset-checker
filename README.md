# Codex 手動重置次數查詢工具

## 專案定位

**專案提供 Node.js CLI 介面，並保留原始 Bash/PowerShell 腳本於 `scripts/` 目錄。**

- 套件名稱：`@willh/codex-reset-checker`
- 行為主軸：純讀取查詢，不修改任何檔案，不安裝額外套件，不輸出 `access_token` / `account_id`
- 查詢 API：`GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

* * *

## 目錄

- [1. 檔案結構](#1-檔案結構)
- [2. 安裝方式](#2-安裝方式)
- [3. CLI 使用方式](#3-cli-使用方式)
- [4. auth.json 來源與欄位](#4-authjson-來源與欄位)
- [5. API Header 規格](#5-api-header-規格)
- [6. 輸出欄位與格式](#6-輸出欄位與格式)
- [7. 錯誤處理](#7-錯誤處理)
- [8. 時間轉換規則](#8-時間轉換規則)
- [9. 發佈到 npm](#9-發佈到-npm)
- [10. 安全與隱私原則](#10-安全與隱私原則)

* * *

## 1. 檔案結構

```text
.
├─ bin/
│  └─ codex-reset-checker.js      Node.js CLI 主程式
├─ scripts/
│  ├─ check-codex-rate-limit.sh   原始 Bash 腳本
│  └─ check-codex-rate-limit.ps1  原始 PowerShell 腳本
├─ package.json
└─ README.md
```

* * *

## 2. 安裝方式

### 從 npm 安裝（建議）

```bash
npm install -g @willh/codex-reset-checker
```

### 本機直接使用

```bash
npm install
```

* * *

## 3. CLI 使用方式

### 全域安裝後直接執行

```bash
codex-reset-checker
```

### 指定 `auth.json` 路徑

```bash
codex-reset-checker --auth /path/to/auth.json
# 或
codex-reset-checker /path/to/auth.json
```

### 不安裝直接執行

```bash
node ./bin/codex-reset-checker.js
node ./bin/codex-reset-checker.js --auth /path/to/auth.json
```

### 從 npm 一次性執行

```bash
npx @willh/codex-reset-checker
```

### 在 Windows 使用 PowerShell 或 CMD

```powershell
# 全域安裝後
codex-reset-checker
# 不建議混用舊腳本，但仍可保留
pwsh -NoProfile -File .\scripts\check-codex-rate-limit.ps1
```

> 注意：PowerShell 範例中，請用自己環境的實際 `auth.json` 位置。

* * *

## 4. auth.json 來源與欄位

本工具會讀取本機登入資訊：

- macOS/Linux 預設：`~/.codex/auth.json`
- Windows 預設：`C:\Users\<使用者>\.codex\auth.json`

只會使用以下欄位：

- `tokens.access_token`（必要）
- `tokens.account_id`（可選，有才放入 request header）

若缺少 `tokens.access_token`，程式直接退出並顯示錯誤訊息，不會送出 API 請求。

* * *

## 5. API Header 規格

| Header 名稱 | 值 |
| --- | --- |
| `Authorization` | `Bearer <access_token>` |
| `OpenAI-Beta` | `codex-1` |
| `originator` | `Codex Desktop` |
| `ChatGPT-Account-ID` | `<account_id>`（若存在才加入） |

請求方法：`GET`

請求 URL：`https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

* * *

## 6. 輸出欄位與格式

程式只回報下列欄位：

- `available_count`
- 每筆 `credit` 的 `granted_at`
- 每筆 `credit` 的 `expires_at`
- 每筆 `credit` 的 `status`

輸出範例：

```text
available_count: 2
credits:
- credit #1
  granted_at: 2026-06-29 12:03:15 +08:00
  expires_at: 2026-07-06 12:03:15 +08:00
  status: active
- credit #2
  granted_at: 2026-06-29 12:03:15 +08:00
  expires_at: 2026-07-13 12:03:15 +08:00
  status: active
```

無資料時：

```text
available_count: 0
credits: 0
```

* * *

## 7. 錯誤處理

常見錯誤訊息（不會洩漏敏感值）：

- `錯誤：找不到 auth.json：<path>`
- `錯誤：auth.json 內未找到 tokens.access_token`
- `錯誤：讀取或解析 auth.json 失敗：...`
- `錯誤：請求 API 失敗，HTTP 401 Unauthorized...`
- `錯誤：請求 API 失敗，HTTP 403 Forbidden...`

若收到 401/403，多半是 token 過期、登入權限問題或會話已失效，請先在 Codex 端重新登入，確認 `~/.codex/auth.json` 已更新。

* * *

## 8. 時間轉換規則

`granted_at` 與 `expires_at` 會依本機時區輸出：

- 格式：`YYYY-MM-DD HH:mm:ss +HH:MM`
- 失敗解析時保留原始值，不中斷輸出

* * *

## 9. 發佈到 npm

```bash
npm login
npm publish --access public
```

建議發佈前確認：

- `name` 為 `@willh/codex-reset-checker`
- `bin.codex-reset-checker` 指向 `bin/codex-reset-checker.js`
- `bin/codex-reset-checker.js` 有執行權限（若以直接執行）

* * *

## 10. 安全與隱私原則

- 不安裝任何非必要套件
- 不修改任何本機檔案
- 不輸出 `access_token` 或 `account_id`
- 只讀取本機 `auth.json`
- 無資料持久化、無快取、無遙測

* * *

## 附錄：舊腳本保留說明

原始 Bash 與 PowerShell 腳本仍保留在 `scripts/`，作為非 Node.js 環境下的備援：

- `scripts/check-codex-rate-limit.sh`
- `scripts/check-codex-rate-limit.ps1`
