# Codex 手動重置額度查詢工具

## 專案目標

本專案原本提供 Linux/macOS 與 Windows 可直接執行的腳本，目的在於 **只讀取** Codex/ChatGPT 的手動重置額度到期資訊。核心限制如下：

- 不安裝任何套件
- 不修改任何檔案
- 不輸出或外洩 `access_token`、`account_id`

## 前置條件

- Linux/macOS：`bash` 與 `python3`
- Windows：`PowerShell`（可用 `pwsh` 或 `powershell.exe`）
- 需有本機登入資訊：
  - macOS/Linux：`~/.codex/auth.json`
  - Windows：`C:\Users\<使用者>\\.codex\\auth.json`

## 檔案

- `check-codex-rate-limit.sh`
  - 對應 Linux/macOS
- `check-codex-rate-limit.ps1`
  - 對應 Windows PowerShell

## 1) Bash 腳本使用

```bash
chmod +x scripts/check-codex-rate-limit.sh

# 使用預設 auth 路徑（~/.codex/auth.json）
./scripts/check-codex-rate-limit.sh

# 指定 auth 路徑
./scripts/check-codex-rate-limit.sh /path/to/auth.json
```

## 2) PowerShell 腳本使用

```powershell
# 預設使用 $env:USERPROFILE\.codex\auth.json
pwsh -NoProfile -File .\scripts\check-codex-rate-limit.ps1

# 指定 auth 路徑
pwsh -NoProfile -File .\scripts\check-codex-rate-limit.ps1 "C:\Users\你自己的使用者\\.codex\\auth.json"
```

## API 設定

- URL：`GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`
- Headers：
  - `Authorization: Bearer <access_token>`
  - `OpenAI-Beta: codex-1`
  - `originator: Codex Desktop`
  - `ChatGPT-Account-ID: <account_id>`（若存在時帶入）

## 輸出欄位

只輸出以下欄位：

- `available_count`
- 每筆 credit 的 `granted_at`
- 每筆 credit 的 `expires_at`
- 每筆 credit 的 `status`

時間會轉成本機時區輸出。

## 錯誤訊息範例

- 找不到 auth 檔：`錯誤：找不到 auth.json：<path>`
- 缺少 access token：`錯誤：auth.json 內未找到 tokens.access_token`
- 呼叫失敗：`錯誤：請求 API 失敗，HTTP Error 401: Unauthorized`
