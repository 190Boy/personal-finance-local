## v0.6.2 更新

股票快照與庫存合併，交易頁新增直接載入與手機卡片，寫入新增版本協調。最新欄位、遷移及限制以 [UPDATE-0.6.2.md](UPDATE-0.6.2.md) 為準；下方舊版說明不代表目前仍分開快照表。所有裝置應關閉舊版後更新。

## v0.6.1 更新

匯入紀錄已共用；交易明細新增雲端歷史；匯入入口先選類別。下方為歷史版本，最新行為、遷移與排重限制以 [UPDATE-0.6.1.md](UPDATE-0.6.1.md) 為準。銀行待核對交易繼續儲存，股票快照保留。

## v0.6.0 更新

股票本機匯入、同份試算表四個股票工作表、快照去重及首頁占比已加入。最新操作、測試限制與部署步驟以 [STOCKS.md](STOCKS.md) 為準。GitHub 為唯一原始碼交接來源。

# v0.5.4：Google 登入入口與帳號提示

預設入口顯示 Google 連接頁；也可選「先使用本機匯入」。這是操作入口，不是公開 GitHub Pages 的存取管制，直接開啟既有功能連結仍可使用本機功能。沒有新增帳號密碼系統、Face ID、長期登入或授權後端。

「在這台裝置記住帳號」預設不勾選。勾選並成功連接後，只將電子郵件存入 localStorage 的 finance-remembered-account-v1，供下次使用 login_hint；不存姓名、頭像、Token、密碼、交易或銀行文件。取消勾選、或設定頁點「忘記這台裝置記住的帳號」會移除記錄。共用裝置不應勾選。儲存空間被封鎖時仍可連接。

重開入口後需使用者點擊重新連接，記住帳號時不強制 select_account；Google 仍可能要求登入、同意或確認，無法保證完全無提示。使用其他 Google 帳號會明確開啟帳戶選擇；已連接時切換及明確登出會清空舊預覽。Token 到期只中斷雲端連接，保留本次尚未儲存的本機預覽。授權 Token 仍只在記憶體，離開頁面時清除。

Google 官方 GIS 元件在登入入口／設定頁預先載入，以利點按時開啟授權視窗；不在載入頁面時自動要求授權或讀取財務資料。離線或元件載入失敗仍可選本機匯入。

連接成功後沿用 v0.5.3 的個人試算表與帳戶清單載入。既有自動儲存預設值與交易核對規則維持原狀。

專案原始碼以 GitHub 為準；依使用者最新決定，不再同步交接 Drive 資料夾。App 寫入使用者自己 Google Sheets 的功能繼續保留。

測試：19 項帳號／雲端／偏好單元測試，以及 10 項 Windows Chrome 模擬 Google 登入流程。真實 Google 授權、iPhone Safari 與主畫面 PWA 尚須實機驗收。

官方參考：https://developers.google.com/identity/oauth2/web/reference/js-reference （TokenClientConfig 的 login_hint 與 prompt）。

# v0.5.1：網站共用 Google OAuth Client ID

OAuth Client ID 已由網站統一設定於 cloud/config.mjs。一般用戶只需點「連接 Google」，選擇自己的帳號並授權；每位用戶的檔案仍由其自己的 Token 存取與建立。已移除個別 Client ID 輸入欄及其 localStorage 設定，啟動時清除舊設定。Repo 僅包含公開 Client ID，不包含 Client Secret。網站管理者負責一次性啟用 API、設定 OAuth origin／測試名單及發布狀態。以下 v0.5.0 的個別 Client ID 設定步驟以本節為準。

# v0.5.0：Google 試算表交易紀錄與銀行存款合計

Google 設定與資料說明見 web/google-setup.html。需由網站擁有者建立 Web OAuth Client ID、啟用 Drive API／Sheets API，再在設定頁連接；沒有 Client ID 時，本機解析仍可使用。使用 Google Identity Services Token 模式，僅請求 drive.file；本工具建立的試算表由使用者自己的 Google 帳戶持有，不會分享。

解析後交易依「銀行存款」類別寫入工作表，含銀行、帳戶代稱；匯入紀錄另頁。帳戶代稱為同步必填，同帳戶需維持同名。已連接且勾選自動儲存時，解析完成會同步；失敗可由交易頁重試。同檔批次以固定 ID／metadata ID 防止重複寫入，交易指紋減少跨檔重疊，同檔真實重複列保留次序。交易列、匯入紀錄及批次標記使用單次 Sheets batchUpdate。不同裝置同時寫入不同但重疊的檔案仍可能留下相同 ID 的列；首頁會依 ID 去重，建議依序匯入。工作表欄位異動時停止寫入，不覆蓋使用者欄位。

首頁合計每個銀行／帳戶最新交易的餘額。舊月份不覆蓋新月份；同日跨來源先後不明、餘額不符的帳戶另列待確認，部分合計明確標示。不推測信用卡或股票餘額，目前兩者沒有匯入器。載入與同步限制 100,000 列；單次原檔限制沿用 50,000 筆。

公開 Client ID 可存 localStorage；Token、交易與餘額僅在記憶體，登出／離開頁面清除，Token 到期需使用者重新連接。Google 授權元件僅在設定連接時載入。CSP 僅增加 Google 官方 GIS／Drive／Sheets 目的地；Service Worker 仍只快取固定公開程式清單，API、帶授權請求與查詢參數一律略過。

驗證：雲端資料及既有 Excel／玉山規則單元測試，Windows Chrome 模擬 Google OAuth／Drive／Sheets 的完整加密匯入→自動儲存→首頁餘額→重複儲存→登出，以及手機寬度檢查。模擬 API 不代表真實 Google 授權驗收；真實帳戶與 iPhone Safari／主畫面 PWA 登入需在 Client ID 設定後確認。

測試：node --test tests/cloud.test.mjs tests/excel.test.mjs tests/esun-layout.test.mjs。瀏覽器測試需 Playwright 與 Chrome；先在專案根目錄啟動 python -m http.server 4178 --bind 127.0.0.1，再執行 node tests/cloud-browser.cjs。FINANCE_TEST_URL 可指定測試站，只使用合成資料與模擬 Google API。

以下歷史版本的「無 OAuth／無上傳交易」說明以本節與設定頁資料說明為準。

