# v0.5.0：Google 試算表交易紀錄與銀行存款合計

Google 設定與資料說明見 web/google-setup.html。需由網站擁有者建立 Web OAuth Client ID、啟用 Drive API／Sheets API，再在設定頁連接；沒有 Client ID 時，本機解析仍可使用。使用 Google Identity Services Token 模式，僅請求 drive.file；本工具建立的試算表由使用者自己的 Google 帳戶持有，不會分享。

解析後交易依「銀行存款」類別寫入工作表，含銀行、帳戶代稱；匯入紀錄另頁。帳戶代稱為同步必填，同帳戶需維持同名。已連接且勾選自動儲存時，解析完成會同步；失敗可由交易頁重試。同檔批次以固定 ID／metadata ID 防止重複寫入，交易指紋減少跨檔重疊，同檔真實重複列保留次序。交易列、匯入紀錄及批次標記使用單次 Sheets batchUpdate。不同裝置同時寫入不同但重疊的檔案仍可能留下相同 ID 的列；首頁會依 ID 去重，建議依序匯入。工作表欄位異動時停止寫入，不覆蓋使用者欄位。

首頁合計每個銀行／帳戶最新交易的餘額。舊月份不覆蓋新月份；同日跨來源先後不明、餘額不符的帳戶另列待確認，部分合計明確標示。不推測信用卡或股票餘額，目前兩者沒有匯入器。載入與同步限制 100,000 列；單次原檔限制沿用 50,000 筆。

公開 Client ID 可存 localStorage；Token、交易與餘額僅在記憶體，登出／離開頁面清除，Token 到期需使用者重新連接。Google 授權元件僅在設定連接時載入。CSP 僅增加 Google 官方 GIS／Drive／Sheets 目的地；Service Worker 仍只快取固定公開程式清單，API、帶授權請求與查詢參數一律略過。

驗證：雲端資料及既有 Excel／玉山規則單元測試，Windows Chrome 模擬 Google OAuth／Drive／Sheets 的完整加密匯入→自動儲存→首頁餘額→重複儲存→登出，以及手機寬度檢查。模擬 API 不代表真實 Google 授權驗收；真實帳戶與 iPhone Safari／主畫面 PWA 登入需在 Client ID 設定後確認。

測試：node --test tests/cloud.test.mjs tests/excel.test.mjs tests/esun-layout.test.mjs。瀏覽器測試需 Playwright 與 Chrome；先在專案根目錄啟動 python -m http.server 4178 --bind 127.0.0.1，再執行 node tests/cloud-browser.cjs。FINANCE_TEST_URL 可指定測試站，只使用合成資料與模擬 Google API。

以下歷史版本的「無 OAuth／無上傳交易」說明以本節與設定頁資料說明為準。

