# 給 Claude 的工作守則

- 先讀 `README.md`（開發與交接說明），照最後的「每完成一個段落的檢查清單」做。
- 試算表欄位、工作表或資料意義有任何改變時：`SCHEMA_VERSION` 加 1，並更新 `docs/BOT.md`。BOT 只看這份說明書，說明書不對，BOT 就會算錯帳。
- 給使用者看的說明用繁體中文白話寫進 `CHANGELOG.md`；`README.md` 只寫給開發者與接手的人。
- 不要刪除 `backup/full-v0.16.1` 分支。
