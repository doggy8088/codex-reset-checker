# Codex 手動重置額度查詢工具

## 專案目標

**本工具只做唯讀查詢，不安裝任何套件、不修改任何檔案、也不輸出或外洩 `access_token` / `account_id`。**

本專案提供兩個可直接使用的腳本，對應 Linux/macOS 與 Windows：

- `check-codex-rate-limit.sh`：Bash（Linux/macOS）
- `check-codex-rate-limit.ps1`：PowerShell（Windows 可用 `powershell.exe` / `pwsh.exe`）

兩者都會：

1. 讀取本機 Codex 登入資訊 (`auth.json`)
2. 從 `tokens.access_token` 取得授權
3. 若存在，帶入 `tokens.account_id` 到 `ChatGPT-Account-ID` header
4. 呼叫唯讀 API：`GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`
5. 僅輸出：
   - `available_count`
   - 每筆 `granted_at`
   - 每筆 `expires_at`
   - 每筆 `status`
6. 將時間轉成本機時區顯示

* * *

## 前置條件

- Linux/macOS：需具備 `bash` 與 `python3`
- Windows：具備 `PowerShell`（建議 `pwsh`，`powershell.exe` 亦可）
- 本機必須有 `~/.codex/auth.json`（macOS/Linux）或 `C:\Users\<使用者>\.codex\auth.json`（Windows）
- 指令僅讀取、查詢，不會更動檔案

* * *

## auth.json 欄位說明

腳本只使用以下欄位：

- `tokens.access_token`（必要）
- `tokens.account_id`（非必要，若有則加到 header）

若缺少 `tokens.access_token`，腳本會立刻終止並顯示錯誤，不會送出 API 請求。

* * *

## 安裝與執行

### 1) Linux / macOS

```bash
chmod +x check-codex-rate-limit.sh

# 使用預設 auth 路徑（~/.codex/auth.json）
./check-codex-rate-limit.sh

# 若需要指定其他 auth 路徑
./check-codex-rate-limit.sh /path/to/auth.json
```

### 2) Windows PowerShell

```powershell
# 預設使用 $env:USERPROFILE\.codex\auth.json
pwsh -NoProfile -File .\check-codex-rate-limit.ps1

# 指定 auth 路徑
pwsh -NoProfile -File .\check-codex-rate-limit.ps1 "C:\Users\你自己的使用者\.codex\auth.json"
```

使用 `powershell.exe` 也可直接執行 `check-codex-rate-limit.ps1`：

```powershell
powershell.exe -NoProfile -File .\check-codex-rate-limit.ps1
```

* * *

## API 呼叫規格

腳本送出的 HTTP 請求 header：

| Header 名稱 | 值 |
|---|---|
| `Authorization` | `Bearer <access_token>` |
| `OpenAI-Beta` | `codex-1` |
| `originator` | `Codex Desktop` |
| `ChatGPT-Account-ID` | `<account_id>`（若 `auth.json` 有才加） |

請求 URL：

`GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`

* * *

## 輸出格式

### 成功輸出

- 先輸出 `available_count`
- 再逐筆輸出 `credit` 內容
- 每筆欄位依序顯示：`granted_at`、`expires_at`、`status`

範例（實際時間與數值依回應而異）：

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

### 當無 credit 時

```text
available_count: 0
credits: 0
```

### 錯誤情境

常見錯誤訊息樣式：

```text
錯誤：找不到 auth.json：<path>
錯誤：auth.json 內未找到 tokens.access_token
錯誤：請求 API 失敗：HTTP Error 401: Unauthorized
錯誤：請求 API 失敗：HTTP Error 403: Forbidden
```

> 錯誤訊息只揭露問題，不會輸出 `access_token` 或 `account_id`。

* * *

## 時間格式與時區

輸出時間皆轉換為**執行主機本機時區**：

- Bash 版格式為 `YYYY-MM-DD HH:mm:ss +0800`
- PowerShell 版格式為 `YYYY-MM-DD HH:mm:ss +08:00`

如果 API 回傳時間無法解析，會原樣輸出原始字串，避免格式轉換失敗造成整體中斷。

* * *

## 安全與隱私原則

**腳本只做唯讀查詢，沒有任何檔案寫入。**

- 不會修改 `auth.json`
- 不會輸出 token 或帳號識別字
- 不會新增外部套件或安裝流程
- 不會嘗試逆向或取得未授權資料

在多人共用設備上，請避免將 `auth.json` 或終端機紀錄分享到不安全位置。

* * *

## 版本相容性與注意事項

| 平台 | 腳本 | 相依 |
|---|---|---|
| Linux/macOS | `check-codex-rate-limit.sh` | `python3`（用來解析 JSON） |
| Windows | `check-codex-rate-limit.ps1` | PowerShell 5.1+ / `pwsh` |

PowerShell 版本會嘗試存取預設路徑 `$env:USERPROFILE\.codex\auth.json`，請確認路徑存在。

* * *

## 常見問題

- **為何有時會回 401/403？**  
  通常是 token 過期、登入憑證失效、或帳號權限限制。請先重新登入 Codex 再試一次。
- **是否一定要有 `account_id`？**  
  不需要。沒有時會略過該 header，只用 `access_token` 查詢。
- **為何有些欄位不是 `credits`？**  
  部分回應可能使用 `items` 或 `data`，腳本有包含這兩種可能名稱以提升相容性。
- **能否改成只輸出 JSON？**  
  目前設計是純文字可閱讀輸出；你可以再包裝一層 `jq`/PowerShell 轉換，仍不會影響核心安全原則。

* * *

## 可直接做的下一步

1. 用你目前登入環境的 `~/.codex/auth.json` / `%USERPROFILE%\.codex\auth.json` 實際執行一次，確認回應是否回到 `credits` 清單。
2. 若有大量筆數，建議先確認 `available_count` 與 `credits` 筆數是否一致，再比對到期日是否符合預期。
3. 若只想每日巡檢，可結合 `cron`（Linux/macOS）或排程工作排程（Windows）定期執行並將輸出導向日誌。
