## v0.6.2 更新

股票快照與庫存合併，交易頁新增直接載入與手機卡片，寫入新增版本協調。最新欄位、遷移及限制以 [UPDATE-0.6.2.md](UPDATE-0.6.2.md) 為準；下方舊版說明不代表目前仍分開快照表。所有裝置應關閉舊版後更新。

## v0.6.1 更新

匯入紀錄已共用；交易明細新增雲端歷史；匯入入口先選類別。下方為歷史版本，最新行為、遷移與排重限制以 [UPDATE-0.6.1.md](UPDATE-0.6.1.md) 為準。銀行待核對交易繼續儲存，股票快照保留。

## v0.6.0 更新

股票本機匯入、同份試算表四個股票工作表、快照去重及首頁占比已加入。最新操作、測試限制與部署步驟以 [STOCKS.md](STOCKS.md) 為準。GitHub 為唯一原始碼交接來源。

# v0.4.0 更新
玉山 Excel／中信 PDF 分流；最新版操作、安全限制與驗收請見 IMPORT-0.4.0.md。新增自託管 SheetJS、Excel Worker、Excel 日期／時間與獨立手續費對應。重新發布時必須一起更新 web/、pdf-parser/ 與根目錄 sw.js；不要只替換 HTML。iPhone Safari／主畫面 PWA 與 Android 仍須實機驗收。

> v0.3.0 最新 Mobile First/PWA 優先實機順序、安裝與 OAuth 待測項目見 PWA.md；以下保留 PDF 欄位驗收要求。

# 第一階段驗收：由使用者本機執行
不能只因 PDF 開啟成功就通過。兩家銀行都必須完成逐筆欄位核對及餘額核對；有異常先停留在解析器校正階段，不開始 OAuth。

## PDF 基礎裝置順序（0.2.0 歷史流程）
1. Windows Google Chrome。先記錄 Windows／Chrome 版本、工具版本、銀行名稱、PDF 頁數與交易筆數。
2. Windows 通過後，在 iPhone Safari 實機測同一檔案或相同期間 PDF，記錄 iPhone 型號、iOS／Safari 版本。使用 GitHub Pages HTTPS 網址；不能從 iPhone 連到 Windows 的 127.0.0.1。
手機尺寸模擬與桌面 WebKit 均不能取代 iPhone 實機測試。此次只執行 Windows 安裝版 Chrome，iPhone 未測。

## 操作
- 選銀行，再選 PDF，最後輸入密碼。空密碼／錯誤密碼都應失敗且清空密碼輸入，重試時自行重新輸入。
- 依原始 PDF 選由舊到新／由新到舊。不可用日期排序掩蓋同日時間或文件漏列。
- 期初餘額是最早一筆交易之前的餘額。沒有期初餘額時最早一筆為 no_opening，不可勾為完整核對。
- 執行本機解析；對照原 PDF 每筆日期、時間、摘要、支出、收入、交易後餘額與頁碼。沒有印時間時可為 null，但不得把有印時間的交易漏成 null。
- 展開錯誤報告，逐一處理未識別表頭、漏日期、金額錯誤、順序錯誤、跨頁歧義與重複候選。
- 跨行轉帳、卡費、股利、手續費、退款提示只供參考，不是已確認的會計分類。
- 勾選「匯出僅供人工核對」後匯出 CSV、JSON，比較筆數與欄位。JSON 用整數分，例 100001 代表 1000.01 元。
- 清除本次資料，確認表格、擷取文字、檔案選擇、密碼與帳戶代碼均清空。重新選檔後可再測。
- 測相同 PDF 重複處理，應提示處理過。不同 PDF、相同帳戶代碼若有完全相同交易，應標記候選並保留；不能自動刪除合法重複交易。

## 沒有自動定位到欄位時
1. 展開「本機擷取文字與座標」，確認中文字、日期與金額是否可讀。每個字串前的百分比是其左緣 X 位置。
2. 對照原 PDF 決定各欄中心位置百分比，展開「欄位位置設定」，勾「使用手動欄位位置」，填日期、摘要、支出、收入、餘額；時間／備註可選。
3. 清除本次資料，以相同檔案與密碼重試。欄位設定保留在表單記憶體，未寫入儲存空間。
4. 仍無法逐欄吻合就判失敗；不要以調整金額或猜測交易讓餘額變得吻合。可僅回報錯誤碼、裝置／版本與不含個資的版型描述；不要傳密碼或真實擷取全文。

## 網路不外傳檢查（Windows）
- 開 Chrome 開發者工具 Network，勾 Preserve log，重新載入頁面。
- 觀察選檔、輸入密碼、解析、匯出整個過程。只應有本站靜態 GET：HTML、CSS、mjs、bcmap 與標準字型。不可有 PDF 請求、POST、含密碼／檔名／交易內容的 URL 或 request body。
- Application 檢查 localStorage、sessionStorage、Cookie；工具不應建立其中任何密碼／交易資料。開發者工具本身可能保留你檢查過的內容，由你自行清理。
- 僅看到同網域也不足以證明安全，還要確認 URL、方法及 request body 沒有敏感資料。
- 不要分享含個資的 HAR、截圖或 console。iPhone 若需完整網路驗證，可用 macOS Safari 的遠端 Web Inspector；沒有該工具時只能記錄「未驗證」，不能直接聲稱網路檢查通過。

## 最低覆蓋
每家銀行：單頁、多頁、跨頁、同日多筆、沒有交易、錯密碼、漏密碼；正確收入／支出、轉帳、卡費、股利、手續費；原順序／反向順序；重複檔、跨檔重複候選；有期初餘額、無期初餘額、故意改錯一個數值的合成負向樣本。
不存在的交易類型應填 N/A 並說明，不應偽造測試結果。

## 驗收判定
通過：原始筆數一致，所有有印出的必要欄位與原檔逐筆一致、無未解決的漏列或歧義、期初餘額可驗證且所有連續餘額一致、匯出一致、裝置與網路檢查完成。
待核對：缺期初餘額、缺某交易類型或裝置測試、只用合成樣本、只有連續餘額吻合。
失敗：任一筆錯欄／漏列／重複誤刪、原檔有時間但漏掉、不能解密、交易計數不符、任何 PDF／密碼向伺服器傳送、崩潰或逾時。

| 銀行 | Windows 真實樣本欄位／餘額 | iPhone Safari 實機 | 匯出核對 | 網路核對 | 總結 |
|---|---|---|---|---|---|
| 中國信託 | 待使用者測試 | 待測 | 待測 | 待測 | 尚未驗收 |
| 玉山銀行 | 待使用者測試 | 待測 | 待測 | 待測 | 尚未驗收 |

## 開發者重跑
- Node >=22：node --test tests/parser.test.mjs
- 產生合成 PDF：Python 3 安裝 reportlab、pypdf、cryptography 後，python tests/generate-fixtures.py test-results/fixtures
- 安裝 Playwright 1.62.1 作為測試依賴，使用 Windows 已安裝 Chrome；node tests/browser.cjs test-results/fixtures test-results/browser
- 若 Playwright 不在預設模組路徑，可設定 PLAYWRIGHT_MODULE；CHROME_PATH 可指定 Chrome。這些只為測試，不是執行網頁的依賴。
- 合成測試結果不能取代真實銀行樣本或 iPhone 驗收。測試產生的 PDF／匯出一律放 test-results/，不要提交公開。

## 新版自動測試
node --test tests/parser.test.mjs tests/sw.test.mjs（22 項）。
node tests/browser.cjs <合成樣本資料夾> <輸出資料夾>（15 項 PDF 回歸）。
先 python tests/generate-fixtures.py test-results/pwa-fixtures --pwa-sentinel，再 node tests/pwa-browser.cjs test-results/pwa-fixtures test-results/pwa-browser（8 項 PWA；以唯一合成標記驗證資料未進快取，真實 PDF 不適用此自動測試）。
PWA 測試模擬 /personal-finance-local/ Repo 子路徑，使用 Windows Chrome 與觸控視窗，不代表 iOS 或 Android 硬體相容性。
