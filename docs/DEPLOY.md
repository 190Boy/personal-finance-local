# 本機執行與部署

## 本機執行

需要 Node.js 22 以上，不需要 `npm install`。

```
npm start
```

開啟 http://127.0.0.1:4173/web/ 。不要用 `file://` 直接開 HTML，瀏覽器會擋下模組與 Worker。

`tools/serve.cjs` 只綁定 127.0.0.1，只提供正式站會公開的檔案（`index.html`、`sw.js`、`web/`、`pdf-parser/`、`cloud/`），只接受 GET／HEAD，拒絕帶查詢參數的請求，不記錄任何內容。其他裝置連不到這個網址。要換連接埠可設 `PORT`，例如 `PORT=4178 npm start`。

本機網址的 Google 登入需要在 Google Cloud 的 OAuth Client 加入 `http://127.0.0.1:4173` 為授權來源，否則只能用本機匯入功能。

## GitHub Pages

網站由 `main` 分支根目錄直接發布（Settings → Pages → Deploy from a branch → `main` / `(root)`）。合併到 `main` 就等於上線，沒有建置步驟。

每次修改公開檔案後，提交前依序執行：

```
npm run format       # 統一排版
npm run build:pwa    # 重新產生 sw.js 的快取清單與版本
npm test             # 單元測試
```

漏掉 `build:pwa` 的話，已安裝的 PWA 會繼續使用舊版快取的程式。改版時同步更新 `web/index.html` 右上角的版本號與 `tools/build-sw.cjs` 的版本字串，方便確認手機已更新。

部署後，關閉所有本站分頁與主畫面 PWA 視窗再重開，確認右上角版本號。仍是舊版時，到「設定」清除公開程式快取，再關閉全部視窗重開。Service Worker 刻意不在使用中強制替換，避免打斷正在進行的匯入。

## 安全邊界

- `web/index.html` 以 meta CSP 限制來源：程式、樣式只允許本站與 Google 登入元件；連線只允許本站、Google 登入與 Drive／Sheets API；不允許 `unsafe-inline`／`unsafe-eval`。
- GitHub Pages 不能設定自訂回應標頭，所以 `frame-ancestors` 等只能靠回應標頭生效的保護無法啟用。
- 不要把真實銀行檔案、匯出結果或任何帳號資料提交到 Repo。Repo 是公開的。
- 第三方套件（PDF.js、SheetJS、officecrypto-tool）放在 `web/vendor/`，要更新時整套替換並重新測試，不要只換單一檔案。
