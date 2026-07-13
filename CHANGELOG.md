# Changelog

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
