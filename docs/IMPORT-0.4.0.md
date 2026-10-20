# v0.4.2：玉山 Excel 手續費自動核對

依使用者確認的規則，支出交易以「前筆餘額－提款－手續費」核對；收入以「前筆餘額＋存入」核對，不扣手續費。原始提款、收入與手續費欄位保持獨立，JSON 標示 feePolicy，餘額檢查保留 feeDebitCents。有效的非零手續費不再單獨造成待核對；餘額不符、未知／負數手續費、公式、錯誤欄位及缺少期初餘額仍保留既有檢查。此規則僅套用玉山 Excel，不變更歷史 PDF 的費用政策。

以下舊版費用說明以本節為準。

# v0.4.1：玉山加密 XLSX 本機解密

玉山 Excel 新增開啟密碼欄位。先選檔；如提示需要密碼，輸入後點「本機解密並讀取 Excel」，確認工作表與欄位，再點「核對欄位並解析 Excel」。選新檔會清空密碼；送出、切換銀行、離開或隱藏頁面也清空輸入欄。密碼只傳入專屬 Worker，讀取完成、取消或 30 秒逾時會終止 Worker；不寫入瀏覽器儲存、日誌或網路。

新增自託管 officecrypto-tool 0.0.19 瀏覽器 bundle，支援經測試的 OOXML Standard AES-128/SHA-1 與 Agile 加密 XLSX。其他加密格式會提示不支援；加密 XLS 尚未納入此功能。加密 XLSX 使用 OLE 容器，不再直接誤判成格式錯誤。原有公式、錯誤值、手續費與餘額人工核對規則不變。

驗證：30 項單元測試通過；Windows Chrome 專屬 Worker 驗證一般／Standard／Agile XLSX、未輸入／錯誤／正確密碼、重試、密碼欄清空、交易預覽與取消。真實樣本只在記憶體驗證解密及解析，仍有待人工核對列，不代表完整交易驗收；檔案與密碼不納入 Repo。iPhone Safari 實際解密仍待使用者確認。

依賴來源：https://github.com/zurmokeeper/officecrypto-tool 。重建方式與固定版本位於 tools/officecrypto/，授權清單位於 web/vendor/officecrypto/THIRD_PARTY_NOTICES.txt。以下舊版限制以本節為準。

# v0.4.0：玉山 Excel／中信 PDF 分流

玉山改以銀行下載的 .xls／.xlsx 在瀏覽器讀取；中信維持 PDF.js 本機解密。玉山 PDF 解析程式保留為歷史來源與回歸測試，正式操作入口不再使用它。CSV／JSON 是預覽匯出格式，本版不提供 CSV 匯入。

玉山表頭：交易日期、交易時間、摘要、提、手續費、存、帳戶餘額、存摺備註、銀行代號/帳號、轉帳留言、財金序號。日期、時間、提款、存入、餘額依欄名對應；手續費獨立，不與提款混用。不自動匯入帳號／財金序號；備註預設取存摺備註，亦可自行更換。

## 操作
1. 確認右上角 v0.4.0；舊版請先清除公開程式快取，關閉全部網站／PWA 視窗後重開。
2. 選玉山銀行（Excel），再選銀行匯出的 Excel；不需輸入 PDF 密碼。
3. 確認工作表、表頭與欄位對應。可以手動選欄，必要欄位不可共用同一欄。
4. 依檔案實際順序選由新到舊／由舊到新。期初餘額為最早交易之前的餘額，不知道可留空。
5. 點本機讀取並解析 Excel，逐筆核對日期、時間、摘要、提款、存入、手續費及餘額；再自行決定匯出 CSV／JSON。
6. 中信選 PDF 後輸入開啟密碼；其餘核對與匯出流程共用。

## 手續費規則
非零或無法解析的手續費會保留獨立金額並標記待核對，不能直接完整驗收通過。因尚未確認是否已包含於提款、是否另外自本帳戶扣款、或僅為跨行費用提示，系統不自行相加或從收入扣抵。不得用餘額反推這項會計處理。

## 本機與限制
固定使用 SheetJS CE 0.20.3，由本專案 web/vendor/sheetjs/ 託管，沒有執行期 CDN。Excel 在專屬 Worker 讀取，30 秒逾時或取消即終止；完成後終止 Worker。預覽與工作表資料只在頁面記憶體，清除、換銀行、離開頁面會釋放參照，不保證作業系統記憶體殘留被覆寫。
支援 XLSX、BIFF XLS，並測試 HTML 表格形式的 .xls。限制 25 MiB、最多 50,000 非空列、256 欄、20 工作表及文字大小上限。加密 Excel 尚未支援。無巨集／公式執行、無外部連線更新；來源有公式或錯誤值時標記待核對，不依快取公式值宣稱通過。
可處理文字日期／時間與 Excel 數值日期／時間（含 1900／1904 日期系統）。未知版型、合計列及錯誤列保留待核對，不靜默丟棄；不正式入帳。
只快取公開程式（含 SheetJS 與 Worker），不快取 Excel、PDF、密碼、交易或 OAuth Token。GAS V1 與部署保留，Google OAuth 仍未實作。

## 官方依據
SheetJS 安裝與自託管：https://docs.sheetjs.com/docs/getting-started/installation/standalone/
讀取選項：https://docs.sheetjs.com/docs/api/parse-options/
日期：https://docs.sheetjs.com/docs/csf/features/dates/

## 測試與交接
52 項單元、Windows Chrome 11 項 Excel、12 項中信 PDF、8 項 PWA 測試通過。測試工作簿與 PDF 全部合成，不代表真實銀行檔案驗收。iPhone Safari／主畫面 PWA、Android 實機尚未測試。

重跑：先執行 node tests/generate-excel-fixtures.cjs 指定測試資料夾，再以 node tests/excel-browser.cjs 資料夾 輸出資料夾 測試；需自行安裝 Playwright 並設定實際 Chrome 路徑。單元測試使用 npm test。

圖示沿用同步時 GitHub 最新檔案與 apple-touch-icon.png 名稱。tools/build-icons.cjs 是舊版產製流程，不要在未備份自訂圖示前重跑。

