# 目前圖示更新方式

Apple Touch Icon 的唯一來源為 web/icons/apple-touch-icon.png（180×180 PNG）。同名替換後，必須將該檔案轉成 Base64，同步替換 index.html、web/index.html 的 apple-touch-icon data URL，並更新 sw.js 的 VERSION。web/icon-test-inline.html 的宣告與預覽圖片也同步更新；web/icon-test-url.html 使用相同來源檔案。舊的 apple-touch-icon-v2.png 保留相容舊頁面，已非目前來源。

正式頁面保留內嵌方式：使用者的 iPhone 測試中，外部圖片網址未顯示主畫面圖示，內嵌同圖則成功。web/index.html 的 CSP img-src 允許 self 與 data:。部署後關閉所有本站頁面／PWA 視窗再重開；舊主畫面捷徑必要時刪除再加入。新圖片仍須實機確認。
