# v0.4.0 同步註記
沿用使用者在 GitHub 更新的圖示；Apple Touch Icon 目前檔名為 apple-touch-icon.png。以下為舊版產製歷史，重跑 build-icons 前應先備份自訂圖示。

# 圖示交接 v0.3.2

source-wallet.png 是原始透明圖片；一般 PNG 只縮放，不 flatten。icon-32、180、192、512 保留 alpha。Apple Touch Icon 使用獨立 apple-touch-icon-180.png，與 maskable 圖示同為 #0756a4 藍底，這兩個系統用途的檔案刻意不透明。Manifest 的 any 與 maskable 用途保持分離。

以 Node.js 與 sharp 執行 tools/build-icons.cjs（先在專案執行 npm install --no-save sharp），再執行 tools/build-sw.cjs 更新公開資源清單與快取版本。圖示來源不列入網站快取。驗證紀錄見 icon-validation.json。

此修改僅修正附加的淺色底，不重畫錢包，也不改變 PDF 或交易處理流程。真實 iPhone Safari／主畫面 PWA 圖示仍須使用者實機測試；系統可能保留舊安裝圖示，必要時刪除主畫面捷徑再加入。
