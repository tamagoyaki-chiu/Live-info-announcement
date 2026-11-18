# Site monitor

每天日本時間 10:00 / 14:00 / 17:00 檢查以下網站，有新公告就發到 Google Chat。

| 代稱 | 網站 | 資料來源 |
|---|---|---|
| zutomayo | https://zutomayo.net/news/ | 頁面 HTML |
| 西野加奈 | https://www.nishinokana.com/info/ | Sony Music JSON (`kananishino`) |
| アジカン | https://www.asiankung-fu.com/s/n80/page/smoj_info | Sony Music JSON (`ASIANKUNG-FU`) |
| 水曜日 | http://www.wed-camp.com/#tour | `data/cms-ja.json` 的 tour |
| LGM | https://www.littlegleemonster.com/info/ | Sony Music JSON (`LittleGleeMonster`) |

- `seen.json`：已通知過的公告 ID，每次執行後由 workflow 自動 commit 回來。
- Webhook 放在 repo 的 Actions secret `GOOGLE_CHAT_WEBHOOK`。
- 某個網站抓取失敗時，其他網站照常檢查，workflow 會標成失敗，GitHub 會寄信通知。
- GitHub 排程常會延遲幾分鐘到半小時左右。
- 手動執行：Actions → Site monitor → Run workflow。

本機測試：

```bash
node monitor.js --dry-run
```

## 台股行情通知

`stock.js`：週一到週五發送加權指數、台積電（2330）、台達電（2308）的行情。

- 日本時間 10:02（台北開盤後）：開盤價、目前價格和漲跌幅。
- 日本時間 14:45（台北收盤後）：收盤卡片，附當日走勢圖（虛線為昨收，漲紅跌綠）。
- 價格來自證交所即時行情，走勢圖用 Yahoo Finance 的 5 分鐘資料，圖片由 QuickChart 產生。
- 當天沒有交易資料時視為休市，不發通知。
- 手動執行：Actions → TW stock report → Run workflow，選 open 或 close。
