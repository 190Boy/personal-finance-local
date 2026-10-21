## v0.7.1更新

首頁改為最新帳單月份「消費」合計，新增估算淨資產；信用卡金額改以元儲存，連接時原子轉換既有分資料，並阻止舊版寫入。請所有裝置關閉舊頁面、確認v0.7.1再連接，不用重新匯入或手動更改金額。詳見 [UPDATE-0.7.1.md](UPDATE-0.7.1.md)，下方為歷史紀錄。

## v0.7.0 信用卡部署更新

新增中信 CSV／凱基 Excel 本機匯入、帳單待繳確認、同一份試算表一張「信用卡」表、共用匯入紀錄與信用卡歷史。詳見 [CREDIT-CARDS.md](CREDIT-CARDS.md)。沒有新增 OAuth 權限或依賴；不改銀行自動儲存與股票流程。發布後請關閉舊網站／PWA視窗再重開，確認v0.7.0；SW公開資源227項。iPhone及真實Google同步待使用者驗收，下方為歷史版本紀錄。

## v0.6.2 更新

股票快照與庫存合併，交易頁新增直接載入與手機卡片，寫入新增版本協調。最新欄位、遷移及限制以 [UPDATE-0.6.2.md](UPDATE-0.6.2.md) 為準；下方舊版說明不代表目前仍分開快照表。所有裝置應關閉舊版後更新。

## v0.6.1 更新

匯入紀錄已共用；交易明細新增雲端歷史；匯入入口先選類別。下方為歷史版本，最新行為、遷移與排重限制以 [UPDATE-0.6.1.md](UPDATE-0.6.1.md) 為準。銀行待核對交易繼續儲存，股票快照保留。

## v0.6.0 更新

股票本機匯入、同份試算表四個股票工作表、快照去重及首頁占比已加入。最新操作、測試限制與部署步驟以 [STOCKS.md](STOCKS.md) 為準。GitHub 為唯一原始碼交接來源。

# v0.4.0 更新
玉山 Excel／中信 PDF 分流；最新版操作、安全限制與驗收請見 IMPORT-0.4.0.md。新增自託管 SheetJS、Excel Worker、Excel 日期／時間與獨立手續費對應。重新發布時必須一起更新 web/、pdf-parser/ 與根目錄 sw.js；不要只替換 HTML。iPhone Safari／主畫面 PWA 與 Android 仍須實機驗收。

# 啟動與 GitHub Pages 部署
建議 Repo 名稱：personal-finance-local。由使用者建立；此次沒有代建 GitHub Repository 或發布網站。

## 本機
完整解壓 source ZIP，雙擊 Start-Local.cmd；它會優先使用 Node.js，否則使用 Python 3。
Windows Chrome 開 http://127.0.0.1:4173/web/ 。不要直接用 file:// 開 HTML。
Node.js 手動方式：在專案根目錄執行 node tools/serve.cjs 。
Python 手動方式：py -3 tools/serve.py 。
伺服器只綁定此電腦的 127.0.0.1，只提供 web/ 與 pdf-parser/ 的靜態 GET／HEAD，不接受上傳、不記錄 URL 或內容。其他裝置不能連到這個本機網址。

## 由你建立 GitHub Pages
1. 在 GitHub 建立公開 Repository，建議 personal-finance-local。
2. 完整解壓 FinanceLocalPDF-0.3.1-pages.zip。把裡面的 index.html、sw.js、.nojekyll、web/ 與 pdf-parser/ 放在 main 分支根目錄，保持原本相對路徑；不是只放 web/，也不要把 ZIP 本身當作網站上傳。
3. Settings > Pages > Build and deployment > Deploy from a branch，選 main 與 /(root)，Save。
4. 等 GitHub 顯示實際發布網址，再開啟該 HTTPS 網址。根頁會跳到 ./web/。不要自行猜網址；以 Pages 顯示的網址為準。
5. 確認頁尾顯示 PDF.js 6.4.299，Network 裡 pdf.mjs、pdf.worker.mjs、cmaps 與 standard_fonts 都來自同一 Pages 網域。
6. 先測 Windows Chrome，再由 iPhone Safari 開同一 HTTPS 網址，按 docs/TESTING.md 驗收。
7. 後續更新必須同步替換 PDF.js 本體、Worker、CMaps、字型；不可只換其中一檔。更新後強制重新整理並重新驗收。

pages ZIP 沒有銀行 PDF、密碼、使用者匯出或 GAS 快照。即使將來源 Repo 設為 private，Pages 的實際公開性仍需依 GitHub 設定與方案確認。不要把真實 PDF 或匯出資料提交到任何公開 Repo。
來源資料夾的 .gitignore 只能降低誤提交風險，不是安全邊界。

## CSP 與 GitHub Pages 限制
web/index.html 具有 CSP meta：default-src none，script／worker／connect／style／img 只允許 self，禁用 object、base 與 form 提交，沒有 unsafe-inline 或 unsafe-eval。
connect-src self 是為了下載同站 CMaps／標準字型；實際應用程式不會把 PDF、密碼或交易資料放進 URL、fetch、XHR、表單或 Beacon。
本機伺服器另加 CSP 回應標頭、frame-ancestors none、nosniff、no-referrer。一般 GitHub Pages 不提供任意自訂回應標頭；meta CSP 無法取代 frame-ancestors 回應標頭。未宣稱 Pages 可防止所有 iframe 嵌入。

## 發布前檢查
只公開 pages ZIP 內容；檢查無真實資料、無 client secret、無共用 GAS URL、無分析腳本。版本和雜湊見 docs/DEPENDENCIES.md 與 FILES.sha256。
OAuth、Sheets API、每人資料庫尚未加入，本頁不要求 Google 登入。

依據：
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions

## v0.3.1 PWA 更新
必須發布根目錄 sw.js、web/manifest.webmanifest 與 web/icons/；完整保留相對路徑。加入 manifest-src self；同站靜態資源預先快取，敏感資料不快取。
修改公開檔案後先 node tools/build-sw.cjs，再執行測試與 tools/package.py。不要把原銀行 PDF、預覽資料或 OAuth 檔案加入 SW 固定清單。
部署新版後先清除預覽、關閉所有該 App／瀏覽器視窗再重開，讓等待中的 Worker 啟用；設定頁可清除此專案公開快取。
安裝與 iPhone／Android 實機驗收詳見 PWA.md。未建立原生 App，未代建或發布 GitHub Repository。
