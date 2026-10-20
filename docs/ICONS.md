# iPhone 實機排查結果：改用內嵌圖示

使用者回報 iOS 27；相同圖片在測試 A（外部 PNG URL）的加入主畫面預覽顯示文字替代圖示，測試 B（data:image/png;base64 內嵌）顯示錢包。這證實本機測試的內嵌方式可行，尚不能推論所有 iOS 27 裝置的根因。

兩個正式 HTML 入口改用與測試 B 相同的內嵌 PNG；web/index.html 的 CSP 僅在 img-src 增加 data:，不放寬腳本、連線或 Worker 權限。Service Worker 快取版本同步更新。圖片來源仍為 web/icons/apple-touch-icon-v2.png；未來換圖需同步更新兩個 HTML 內嵌內容。正式頁面仍待使用者實機確認。

# Safari 圖示快取排查

HTML 改用 apple-touch-icon-v2.png（與原圖相同的 180×180 PNG），讓 Safari 使用新的圖示網址；根目錄與 web/ 入口均宣告，Service Worker 固定清單及快取版本同步更新。原圖保留以相容舊頁面。本次不改圖片設計，不代表 iPhone 實機已通過。

部署完成後關閉所有本站 Safari／PWA 視窗，重新開啟 web/，刪除舊捷徑再加入主畫面。若仍顯示文字替代圖示，需繼續以 iPhone 實機排查。

# v0.4.0 同步註記
沿用使用者在 GitHub 更新的圖示；Apple Touch Icon 目前檔名為 apple-touch-icon.png。以下為舊版產製歷史，重跑 build-icons 前應先備份自訂圖示。

# 圖示交接 v0.3.2

source-wallet.png 是原始透明圖片；一般 PNG 只縮放，不 flatten。icon-32、180、192、512 保留 alpha。Apple Touch Icon 使用獨立 apple-touch-icon-180.png，與 maskable 圖示同為 #0756a4 藍底，這兩個系統用途的檔案刻意不透明。Manifest 的 any 與 maskable 用途保持分離。

以 Node.js 與 sharp 執行 tools/build-icons.cjs（先在專案執行 npm install --no-save sharp），再執行 tools/build-sw.cjs 更新公開資源清單與快取版本。圖示來源不列入網站快取。驗證紀錄見 icon-validation.json。

此修改僅修正附加的淺色底，不重畫錢包，也不改變 PDF 或交易處理流程。真實 iPhone Safari／主畫面 PWA 圖示仍須使用者實機測試；系統可能保留舊安裝圖示，必要時刪除主畫面捷徑再加入。
