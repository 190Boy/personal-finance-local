# 現金記帳（personal-finance-local）— 開發與交接說明

> 這份寫給開發者與接手的人。使用者看的更新內容在 [CHANGELOG.md](CHANGELOG.md)；給整理帳務的 BOT 看的說明書不放在這裡（見下方「BOT 說明書」）。

## 這是什麼

一個純前端 PWA，部署在 GitHub Pages：<https://190boy.github.io/personal-finance-local/web/>。

- **做的事**：Andy 手動記現金收支，也可以順手記其他渠道（銀行、信用卡、LINE Pay、自訂渠道）當作對帳參考。記帳先存在手機，連上 Google 後同步到他雲端硬碟裡的「現金記帳」試算表。
- **不做的事**：銀行、信用卡、股票的匯出檔交給 BOT 處理，網站不處理。
- **沒有後端**。資料只存在使用者裝置（localStorage）和他自己的 Google 試算表。
- **舊的完整版**：v0.16.1 以前有銀行、信用卡、股票、雲端發票、LINE Pay、報表等功能，保存在 `backup/full-v0.16.1` 分支，**不要刪**。

目前版本：v1.3.0，資料格式版本 4。

## 架構

| 檔案 | 職責 |
|---|---|
| `cloud/cash.mjs` | 純邏輯：記帳驗證、渠道、現金餘額、合併、各工作表欄位與讀寫格式、自訂選項。不碰網路與 DOM。 |
| `cloud/cash-local.mjs` | 手機上的記帳、設定、選項與待同步清單（localStorage `cash-ledger-v1`）。 |
| `cloud/cash-store.mjs` | Google Drive／Sheets：尋找或建立試算表、補齊工作表、同步。 |
| `cloud/auth.mjs` | Google Identity Services 授權（Token 只在記憶體）。 |
| `cloud/categories.mjs` | 內建分類樹與圖示。 |
| `cloud/config.mjs` | OAuth Client ID。 |
| `cloud/login-preferences.mjs` | 記住上次登入的 Google 帳號（只存 email，供 login hint 使用）。 |
| `web/app.mjs` | 畫面：首頁、記一筆、設定、首次詢問現金。 |
| `web/rows.mjs` | 一列式清單元件。 |
| `web/pwa.mjs`、`tools/build-sw.cjs` → `sw.js` | 離線快取（只快取公開的程式檔）。 |

### 同步模型（改之前一定要懂）

- **異動紀錄**只增不改：每次新增、修改、刪除都 append 一列。同一個 ID 以「更新時間」最新的那列為準，這是多台裝置合併的依據。
- 每次同步的步驟：
  1. 讀異動紀錄、設定、選項，以及「記帳明細」（`readDetailEdits()`）：ID 空白的列是使用者在試算表打的新記帳，內容和異動紀錄不同的列是修改，類型「刪除」是刪除；整列刪掉不算。任何一列看不懂就丟出 `SHEET_ROWS` 並停止，什麼都不寫，避免蓋掉使用者打的字。
  2. 和手機上的資料合併，新的勝出。
  3. 把手機上比較新的版本 append 到異動紀錄。
  4. **整份重寫**記帳明細、月份統計、設定、選項。
- 同步進行中又有新的修改時，`CashLocal.synced()` 會保留那些修改，留到下一次同步。
- 試算表是用 Drive `appProperties`（`cashApp=personal-finance-cash-v1`）找到的，所以使用者可以改檔名、搬資料夾。但工作表名稱不能改，「建立副本」會失去 appProperties。
- 權限只有 `drive.file`：網站只能存取它自己建立的檔案。所以試算表一定要由網站建立，使用者手動建的檔案網站打不開。
- 現金餘額：設定的金額是「設定日 00:00 的現金」，設定日（含）以後往後加減，之前的往回推。只有渠道是「現金」的記帳會影響餘額；提款、存入的渠道固定是現金。

### 相容性

- 資料格式版本 1（v1.0.0）的異動紀錄沒有「渠道」欄。讀取時視為現金；`ensureSheets()` 會改寫表頭，只覆蓋第一列。
- 改欄位時，`readLog()` 要同時接受新舊表頭，否則舊使用者的資料會讀不到。

## 開發

```sh
npm test          # 單元測試（含模擬 Drive／Sheets 的兩台裝置同步與 v1 升級）
npm run build:pwa # 改了 web/ 或 cloud/ 的檔案後必跑，更新 sw.js
npm start         # 本機預覽 http://127.0.0.1:4173/web/
```

- 格式化：`npx prettier@3.9.10 --write cloud web tests tools README.md CHANGELOG.md docs`
- 介面不使用 innerHTML，CSP 很嚴格（見 `web/index.html` 的 meta）。
- Service Worker 不會 skipWaiting：新版要等使用者完全關掉 App 再開。

## 每完成一個段落的檢查清單

1. `npm test` 通過，`npm run build:pwa` 已執行。
2. 版本號一起改：`package.json`、`tools/build-sw.cjs`、`web/index.html` 的版本字樣（頂端列與設定頁兩處）、本檔的「目前版本」。
3. `CHANGELOG.md` 加一段給 Andy 看的白話說明（新增、修正、補充說明）。
4. **只要試算表的欄位、工作表或資料意義有任何改變**：
   - `cloud/cash.mjs` 的 `SCHEMA_VERSION` 加 1。
   - 更新 BOT 說明書（見下方）：開頭的「對應資料格式版本」、受影響的章節、最後的版本紀錄。
   - 確認舊格式還讀得到。
5. 只改畫面、沒動到資料時，不用改 `SCHEMA_VERSION`，但要看一下 BOT 說明書有沒有描述到畫面行為。
6. 開分支、發 PR、Squash 合併；已合併的 `claude/*` 分支可以刪，`backup/full-v0.16.1` 不要刪。

## BOT 說明書

- 因為這個 repo 是公開的，BOT 說明書**不放在 repo**。它存在 Andy 的雲端硬碟：「102_我的理財紀錄」資料夾裡的 Google 文件「BOT 說明書（現金記帳）」。
- 內容包括：試算表每張表、每個欄位的意義，類型與渠道的計算規則，和匯出檔比對的建議，現金驗算方式。
- 更新方式：
  1. 用 Google Drive 連接器讀出現有內容。
  2. 修改。
  3. 以同一個標題、在同一個資料夾上傳新的 Google 文件（用 Markdown 轉檔時，表格儲存格裡不要用粗體，否則會顯示成 `**`）。
  4. 確認新文件的內容正確後，把舊的移到垃圾桶。
- 因為每次更新檔案 ID 都會變，BOT 要用「資料夾＋標題」找說明書，不要記 ID。
- 沒有 Google Drive 連接器時，不要把說明書寫進 repo；請 Andy 自己更新那份文件，或等可以連接時再做。
