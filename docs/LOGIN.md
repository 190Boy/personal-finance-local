# v0.5.4：Google 登入入口與帳號提示

預設入口顯示 Google 連接頁；也可選「先使用本機匯入」。這是操作入口，不是公開 GitHub Pages 的存取管制，直接開啟既有功能連結仍可使用本機功能。沒有新增帳號密碼系統、Face ID、長期登入或授權後端。

「在這台裝置記住帳號」預設不勾選。勾選並成功連接後，只將電子郵件存入 localStorage 的 finance-remembered-account-v1，供下次使用 login_hint；不存姓名、頭像、Token、密碼、交易或銀行文件。取消勾選、或設定頁點「忘記這台裝置記住的帳號」會移除記錄。共用裝置不應勾選。儲存空間被封鎖時仍可連接。

重開入口後需使用者點擊重新連接，記住帳號時不強制 select_account；Google 仍可能要求登入、同意或確認，無法保證完全無提示。使用其他 Google 帳號會明確開啟帳戶選擇；已連接時切換及明確登出會清空舊預覽。Token 到期只中斷雲端連接，保留本次尚未儲存的本機預覽。授權 Token 仍只在記憶體，離開頁面時清除。

Google 官方 GIS 元件在登入入口／設定頁預先載入，以利點按時開啟授權視窗；不在載入頁面時自動要求授權或讀取財務資料。離線或元件載入失敗仍可選本機匯入。

連接成功後沿用 v0.5.3 的個人試算表與帳戶清單載入。既有自動儲存預設值與交易核對規則維持原狀。

專案原始碼以 GitHub 為準；依使用者最新決定，不再同步交接 Drive 資料夾。App 寫入使用者自己 Google Sheets 的功能繼續保留。

測試：19 項帳號／雲端／偏好單元測試，以及 10 項 Windows Chrome 模擬 Google 登入流程。真實 Google 授權、iPhone Safari 與主畫面 PWA 尚須實機驗收。

官方參考：https://developers.google.com/identity/oauth2/web/reference/js-reference （TokenClientConfig 的 login_hint 與 prompt）。

