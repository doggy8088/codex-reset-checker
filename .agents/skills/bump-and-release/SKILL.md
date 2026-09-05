---
name: bump-and-release
description: 為本專案 codex-reset-checker 升版、同步版本資訊與變更紀錄、提交並透過既有 GitHub Actions 完成 npm 與 GitHub Release 發佈。適用於要求 bump and release 或呼叫 $bump-and-release 的任務；未指定升版級別時使用 patch。
---

# Bump and release

**預設 patch，沿用專案既有 CI 發佈。** 從目前 checkout 執行，不固定本機絕對路徑。所有說明、CHANGELOG 與提交正文使用正體中文及台灣用語。

* * *

## 版本與授權

| 提示 | 行為 |
| --- | --- |
| `$bump-and-release` | patch |
| `$bump-and-release patch` | patch |
| `$bump-and-release patch version` | patch |
| 明確指定 minor 或 major | 使用指定級別 |
| 明確指定完整 SemVer 版本號 | 使用指定版本 |

`version` 是可省略的自然語言用詞。未指定級別時使用 patch，不依 feat 或 BREAKING CHANGE 自行提高級別。完整版本號必須高於目前版本；多個指示互相矛盾或指定值無效時先釐清。

直接要求使用本技能升版並發佈，包含本次發佈所需提交與推送的授權，不再重複詢問。僅要求建立、修改、解釋技能，或明確要求計畫、預覽時，不執行發佈。遵守使用者限定的範圍與目前執行模式。

* * *

## 確認發佈範圍

1. 以 Git 根目錄定位專案，核對套件名稱 `@willh/codex-reset-checker` 與 remote 對應 `doggy8088/codex-reset-checker`，接受 SSH 或 HTTPS URL。不同專案時停止套用此流程。
2. 讀取適用的 AGENTS.md、README 發佈章節、`.github/workflows/ci.yml` 與 `pages.yml`。以目前工作流程為準；本技能記錄的流程若已不適用，先界定差異。
3. 檢查分支、完整 staged/unstaged/untracked 差異、遠端 main 與 tags。更新遠端資訊後確認是否落後、分歧或有尚未發佈的本地提交。發佈會包含推送範圍的所有提交，必須一併檢視。
4. 將本次任務已確認的修改納入發佈，明確列出將提交的檔案或區塊。保留無關修改，不使用無差別 `git add .`。歸屬不明且會影響發佈內容時才釐清；必要時用隔離 checkout 驗證實際待提交內容，避免未提交修改影響測試結果。
5. 讀取目前版本並計算目標版本。核對遠端 tag、GitHub Release 與 npm registry 是否已有目標版本。區分查無版本與網路、驗證或權限錯誤，後者不能當作版本可用。新發佈若版本已占用則停止並回報，不自行跳到下一版。若正在恢復同一次發佈，沿用已記錄版本與提交查明進度。

* * *

## 更新與驗證

同步以下位置，保留其他內容與既有格式：

- `package.json` 的 `version`。
- `package-lock.json` 的根層 `version` 及 `packages[""].version`。
- `public/index.html` 結構化資料中的 `softwareVersion`。
- `CHANGELOG.md` 頂端新增版本與當日日期，沿用現有分類，以前次發佈至本次的實際差異與提交紀錄撰寫使用者可理解的變更。保留歷史版本與日期。

優先使用精準編輯，不使用會自動提交或建立 tag 的升版命令，也不對全專案做版本字串取代。執行 `npm test`、`npm pack --dry-run`、`git diff --check`，並確認 `node bin/codex-reset-checker.js --version` 等於目標版本、上述版本欄位一致、打包內容正確。任一檢查失敗先處理與本次發佈相關的原因，成功後才提交推送。

* * *

## 提交與交由 CI 發佈

1. 使用 `chore(release): <version>` 作為升版提交第一行，第二行必須空白，正文摘要說明變更與驗證結果。如有重大不相容變更，加入 `BREAKING CHANGE:`；已知關聯議題才加入 `Refs:`。
2. 用 `commit_msg_file="$(mktemp -t codex-commit-message)"` 建立隨機訊息暫存檔，以可用的檔案編輯工具寫入完整 UTF-8 純文字。檢查 staged diff 後固定使用 `git commit -F "$commit_msg_file"`，不用 `-m`。提交後核對實際提交內容。
3. 在 main 且能正常快轉推送時，推送本次確認的 main 提交到已核對的遠端，記錄 SHA。非 main 時依專案既有 PR／合併規則處理；若查無規則或缺少必要合併權限，保留準備結果並說明阻礙。不自行繞過分支保護或強制推送。
4. 由 CI 通過 Node.js 測試矩陣及打包檢查，再建立草稿 Release、以 OIDC 發佈 npm、公開 `v<version>` Release。發行記錄由工作流程依 git log 產生。不要另外在本機建立 tag、Release 或執行 npm publish。
5. 追蹤與該 SHA 對應的 CI run；若更新 public，亦追蹤對應 Pages run。可使用 `gh run list/view` 查詢並持續等待完成，定期回報進度，不以「已推送」當作發佈完成。

**完成條件：** 該提交的 CI 發佈成功、npm 可查得目標版本、GitHub Release 已公開、遠端 tag 指向該提交，且本次觸發的 Pages 部署成功。回報版本、提交 SHA、npm 與 GitHub Release 連結，以及部署結果。

* * *

## 中斷與恢復

- 查詢失敗時先查明網路或權限問題，保留版本、SHA 與 run ID。狀態不明不代表未發佈。
- CI 失敗時讀取失敗步驟及 logs，核對 npm、草稿／公開 Release、tag 的實際狀態。修正或重跑僅限既有授權範圍；暫時性錯誤可對同一提交重跑一次，重複失敗則回報具體阻礙。
- npm 已發佈但 Release 尚未公開時，恢復原提交的工作流程，讓其略過已存在的 npm 版本；不重複升版。
- tag 已指向不同提交時，不移動或刪除 tag。若修復需要新的程式碼提交及新版本，先說明已發佈狀態與必要的新發佈範圍。
- Pages 單獨失敗時，明確回報套件已發佈、網站部署失敗，僅處理 Pages，不重新發佈套件。
