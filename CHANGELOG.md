# Changelog

## [0.6.1] - 2026-07-14

### Added

- 新增位於 `public/` 的一頁式產品介紹頁，提供響應式桌機、平板與手機版面。
- 新增產品操作截圖、可複製的 `npx @willh/codex-reset-checker` 指令與清楚的安全隱私說明。
- 新增 canonical、robots、Open Graph、Twitter Card 與 `WebSite`、`SoftwareApplication` JSON-LD 結構化資料。
- 新增以實際產品頁擷取並針對 Facebook 最佳化的 1200 × 630 JPEG 分享圖片。
- 新增 `PRODUCT.md`，記錄產品定位、使用者、品牌個性、設計原則與無障礙方向。
- 新增 CLI 未知選項、重複路徑、缺少 `--auth` 參數與敏感 JSON 輸出的測試。

### Changed

- CLI 參數解析改為拒絕未知選項、重複 `auth.json` 路徑與缺少值的 `--auth`，並支援 `--auth=<path>`。
- API 請求新增固定 15 秒牆鐘期限與 1 MiB 回應大小上限，避免慢速串流或異常回應長時間占用程序。
- JSON 輸出會再次遮罩 API 回應中可能出現的 `access_token` 與 `account_id`。
- 監看模式可從同一個輸入 chunk 正確辨識 `q` 或 `Ctrl+C` 並結束。

### Fixed

- 修正 HTTP response stream 錯誤未被明確處理的問題。
- 修正以 socket inactivity timeout 代替完整請求期限，導致持續傳輸的請求可能永不逾時。
- 修正監看模式收到批次鍵盤輸入時可能漏掉 `q` 結束指令。
- 修正產品頁在手機與平板斷點的欄位溢位、中文詞組斷行、指令框 padding 與圖示對齊問題。

## [0.6.0] - 2026-07-14

### Added

- 新增 ChatGPT 帳戶狀態查詢，從 `entitlement.expires_at` 取得目前方案的實際到期時間。
- 相容舊版帳戶回應的 `account_plan.subscription_expires_at_timestamp` 欄位，並支援 Unix 秒數、毫秒數與 ISO 日期字串。
- 標頭新增目前方案與方案到期時間；資料不存在或帳戶查詢失敗時明確顯示 `N/A`。

### Changed

- 將監看模式的「下次刷新」倒數移至畫面最下方，與 `Spacebar` 刷新及 `q` 結束提示顯示於同一列。
- 將 `prolite` 方案名稱顯示為 `Pro 5x`，並將 `pro` 方案名稱顯示為 `Pro 20x`。
- 窄版終端機無法容納查詢時間與方案資訊時，會自動將方案資訊換至標頭下一列並維持靠右對齊。
- 倒數計時的每秒更新改為只重繪最下方操作提示列，避免修改標頭與其他額度內容。

### Fixed

- 修正誤將每週額度重置時間當成方案到期時間的問題。
- 修正帳戶狀態端點因缺少 `Accept`、`Origin`、`Referer` 與瀏覽器 `User-Agent` 標頭而回傳 `403 Forbidden`，導致方案到期時間顯示為 `N/A` 的問題。
- 修正監看模式倒數更新仍定位至標頭第 3 列的問題，使游標儲存與還原只作用於最下方提示列。

## [0.5.1] - 2026-07-13

### Added

- 新增下次自動刷新的倒數秒數，並支援在監看模式按下 `Spacebar` 立即刷新。
- 新增按下 `q` 結束監看程序，並在畫面最後一行顯示刷新與結束操作提示。

### Changed

- 按下 `Spacebar` 後會重設 60 秒自動刷新排程。
- 將畫面清除延後至新資料即將輸出時，避免手動刷新期間出現空白畫面。
- 結束監看模式時會完整復原終端機 Raw Mode 與輸入串流狀態。

## [0.5.0] - 2026-07-13

### Added

- 新增 `-w` 與 `--watch` 監看模式，每 60 秒自動清空畫面並刷新資料。
- 新增終端機欄列尺寸變更偵測，在視窗或字體縮放影響版面時自動重繪。

### Changed

- 監看模式會序列化刷新工作並在單次刷新失敗後繼續執行，避免輸出重疊或程序提前結束。

## [0.3.0] - 2026-07-12

### Added

- 新增使用額度與 GPT-5.3-Codex-Spark 額度顯示。
- 新增表格卡片、Progress Bar、終端機寬度自動調整與結構化 JSON 欄位。

### Changed

- 使用額度與手動重置額度分區顯示，並保留非公開端點失敗時的降級處理。

## [0.2.3] - 2026-07-02

### Changed

- 在標題列顯示版本號改為「Codex 手動重置額度查詢 (v<版本>)」格式。
- 讓標題版本值直接從 `package.json` 讀取，避免手動同步。

## [0.2.2] - 2026-07-02

### Changed

- 新增終端機版面判斷：當寬度足夠時，將 Credits 明細以兩欄顯示。
- 在主頁面標題中加入版本號 `v0.2.2`。

## [0.2.1] - 2026-06-29

### Changed

- Added `repository` field to `package.json` using the project GitHub URL.
- Bumped patch version to `0.2.1`.

## [0.2.0] - 2026-06-29

- Initial release.
