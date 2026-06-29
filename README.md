# Codex 手動重置次數查詢工具

## 專案介紹

這是用來查詢 Codex/ChatGPT 手動重置額度與到期時間的 CLI 工具，重點在於快速、穩定地取得目前可用額度資訊。

工具會讀取本機 Codex 登入資訊中的存取權杖，呼叫 ChatGPT 後端 API 取得目前可用的手動重置額度清單，並以終端機友善格式顯示每筆額度的取得時間、到期時間與剩餘時間。整個流程只做查詢，不會修改本機檔案，也不會輸出 `access_token` 或 `account_id`。

快速開始：

```bash
npx @willh/codex-reset-checker
```

![Codex 手動重置額度查詢結果](assets/codex-reset-checker-screenshot.png)

* * *

## 目錄

- [1. 檔案結構](#1-檔案結構)
- [2. 安裝方式](#2-安裝方式)
- [3. CLI 使用方式](#3-cli-使用方式)
- [4. 執行畫面](#4-執行畫面)
- [5. auth.json 來源與欄位](#5-authjson-來源與欄位)
- [6. API Header 規格](#6-api-header-規格)
- [7. 輸出欄位與格式](#7-輸出欄位與格式)
- [8. 錯誤處理](#8-錯誤處理)
- [9. 時間轉換規則](#9-時間轉換規則)
- [10. 發佈到 npm](#10-發佈到-npm)
- [11. 安全與隱私原則](#11-安全與隱私原則)

* * *

## 1. 檔案結構

```text
.
├─ bin/
│  └─ codex-reset-checker.js      Node.js CLI 主程式
├─ assets/
│  └─ codex-reset-checker-screenshot.png
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

### 輸出原始 JSON

```bash
codex-reset-checker --json
codex-reset-checker --auth /path/to/auth.json --json
```

`--json` 會直接輸出 API 回傳結果的單行 JSON，不套用框線、顏色或人性化時間文字，適合交給其他工具處理。

### 不安裝直接執行

```bash
node ./bin/codex-reset-checker.js
node ./bin/codex-reset-checker.js --auth /path/to/auth.json
node ./bin/codex-reset-checker.js --json
```

### 從 npm 一次性執行

```bash
npx @willh/codex-reset-checker
```

### 在 Windows 使用 PowerShell 或 CMD

```powershell
codex-reset-checker
```

> 注意：如需指定 `auth.json` 路徑，請改用自己環境的實際檔案位置。

* * *

## 4. 執行畫面

![Codex 手動重置額度查詢結果](assets/codex-reset-checker-screenshot.png)

* * *

## 5. auth.json 來源與欄位

本工具會讀取本機登入資訊：

- macOS/Linux 預設：`~/.codex/auth.json`
- Windows 預設：`C:\Users\<使用者>\.codex\auth.json`

只會使用以下欄位：

- `tokens.access_token`（必要）
- `tokens.account_id`（可選，有才放入 request header）

若缺少 `tokens.access_token`，程式直接退出並顯示錯誤訊息，不會送出 API 請求。

* * *

## 6. API Header 規格

| Header 名稱 | 值 |
| --- | --- |
| `Authorization` | `Bearer <access_token>` |
| `OpenAI-Beta` | `codex-1` |
| `originator` | `Codex Desktop` |
| `ChatGPT-Account-ID` | `<account_id>`（若存在才加入） |

請求方法：`GET`

請求 URL：`https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

* * *

## 7. 輸出欄位與格式

程式只回報下列欄位：

- `available_count`
- 每筆 `credit` 的 `granted_at`
- 每筆 `credit` 的 `expires_at`
- 每筆 `credit` 的 `status`
- `expires_at` 會同時附上精簡剩餘時間（例如：`剩餘 2d 3h 20m`、`到期已過 10m`）

輸出範例：

```text
┏━ Codex 手動重置額度查詢結果 ━━━━━━━━━━━━━━━━━━━
查詢時間：2026-06-29 14:00:00 +08:00
可用額度：2 次
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
額度清單
┌────────────────────────────────────────────────────────┐
│ #001                                                   │
│ [可用] status=active 仍在有效                         │
│ [充足] 剩餘 7d 0h 0m                                │
│ [期限] 獲得 2026-06-29 12:03  到期 2026-07-06 12:03  │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│ #002                                                   │
│ [可用] status=active 仍在有效                         │
│ [充足] 剩餘 14d 0h 0m                               │
│ [期限] 獲得 2026-06-29 12:03  到期 2026-07-13 12:03  │
└────────────────────────────────────────────────────────┘
```

無資料時：

```text
┏━ Codex 手動重置額度查詢結果 ━━━━━━━━━━━━━━━━━━━
查詢時間：2026-06-29 14:00:00 +08:00
可用額度：0 次
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
額度清單
```

JSON 輸出範例：

```json
{"available_count":2,"credits":[{"granted_at":"2026-06-29T04:03:15Z","expires_at":"2026-07-06T04:03:15Z","status":"active"}]}
```

* * *

## 8. 錯誤處理

常見錯誤訊息（不會洩漏敏感值）：

- `錯誤：找不到 auth.json：<path>`
- `錯誤：auth.json 內未找到 tokens.access_token`
- `錯誤：讀取或解析 auth.json 失敗：...`
- `錯誤：請求 API 失敗，HTTP 401 Unauthorized...`
- `錯誤：請求 API 失敗，HTTP 403 Forbidden...`

若收到 401/403，多半是 token 過期、登入權限問題或會話已失效，請先在 Codex 端重新登入，確認 `~/.codex/auth.json` 已更新。

* * *

## 9. 時間轉換規則

`granted_at` 與 `expires_at` 會依本機時區輸出：

- 查詢時間格式：`yyyy-MM-dd HH:mm:ss +HH:MM`
- `granted_at` 與 `expires_at` 格式：`yyyy-MM-dd HH:mm`
- 失敗解析時保留原始值，不中斷輸出
- `--json` 模式不轉換時間格式，直接保留 API 回傳值

* * *

## 10. 發佈到 npm

```bash
npm login
npm publish --access public
```

建議發佈前確認：

- `name` 為 `@willh/codex-reset-checker`
- `bin.codex-reset-checker` 指向 `bin/codex-reset-checker.js`
- `bin/codex-reset-checker.js` 有執行權限（若以直接執行）

* * *

## 11. 安全與隱私原則

- 不安裝任何非必要套件
- 不修改任何本機檔案
- 不輸出 `access_token` 或 `account_id`
- 只讀取本機 `auth.json`
- 無資料持久化、無快取、無遙測
