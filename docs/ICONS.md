# 圖示更新方式

Apple Touch Icon 的唯一來源是 `web/icons/apple-touch-icon.png`（180×180 PNG）。替換這個檔案後：

1. 把檔案轉成 Base64，同步替換 `index.html` 與 `web/index.html` 裡 `apple-touch-icon` 的 data URL。
2. 執行 `npm run build:pwa` 重新產生 `sw.js`。
3. 部署後關閉所有本站頁面與主畫面 PWA 視窗再重開；舊的主畫面捷徑必要時刪除後重新加入。

正式頁面使用內嵌圖片，是因為 iPhone 實測時外部圖片網址不會顯示成主畫面圖示，內嵌同一張圖才成功。`web/index.html` 的 CSP `img-src` 因此允許 `data:`。新圖片仍需在 iPhone 實機確認。

一般圖示 `icon-32／180／192／512` 保留透明邊角；Apple 與 maskable 圖示用藍色實底，避免系統合成透明區時出現白邊。
