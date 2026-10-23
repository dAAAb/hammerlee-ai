# 川伯，聊聊

Three.js 立體市政資訊互動網站。雙方對話皆為預寫腳本，非李四川本人原話或即時回覆；示範回覆不代表訪客意見。主網域 `hammerlee.ai`，`hammerlee.tw` 以 301 轉往主網域。

## 開發與建置

```sh
npm install
npm run dev
npm test
npm run build
```

Vite 本機預覽提供畫面；雲端保存 API 由正式 Worker 提供。正式建置會將客戶端資源包入 `dist/server/index.js`，部署規格與環境變數見 `server/README.md`。秘密僅保存在主機環境，禁止放入 `VITE_` 變數或 Git。

## 互動

- 固定 48 則對話，依閱讀位置逐則送出；可回看、跳至任一主題或直接到結尾。
- 8 個主題各 4 套腳本，`8! × 4^8 = 2,642,411,520` 種順序與說法組合。128-bit seed 決定劇本與徽章。v1 重播保留，新旅程使用 v2。
- 主畫面中文字為輪廓擠出幾何；氣泡、表情、貼圖、小工班及徽章也是真正三維模型。照片使用影像材質與立體框。
- 官方照片頭貼可開人物卡、完整照片、下載、官方粉專與官網。資料來源與使用限制見 `research/`。
- 通知音、震動與手機感應預設關閉，由訪客點選開啟。瀏覽器不支援時明確提示。快轉與回看不連續觸發通知。
- 大字模式、鍵盤操作、減少動畫、語意文字副本與純文字閱讀。
- 原生分享、相同旅程連結、對話紀念卡及三維貼圖 PNG 下載。

說明視窗、人物卡、錯誤通知及純文字模式使用原生介面，保留輔助技術相容性。匯出紀念卡為 2D 圖片，含實際三維徽章渲染。

## Supabase

專案：`moydlexgxsrqawsqqttm`，東京區域。schema 見 `supabase/schema.sql`。所有資料表啟用 RLS，瀏覽器角色沒有直接讀寫權；`journeys` Edge Function 以伺服器專用秘密驗證每次請求。秘密在資料庫只保存 SHA-256 digest。

只保存預寫劇本、版本、隨機編號與時間，不收集訪客姓名、自由輸入或政治偏好。劇本不可修改；相同編號綁定同一版本。分享連結可公開閱讀。PNG 社群預覽由可信劇本生成，失敗時使用品牌備用圖。

初始保護限制為每個日別匿名 HMAC 來源 30 次新建、全站每天 1,000 次新建。相同編號重播不計入新建。上線大規模推廣前應依實際容量與帳單調整 `register_journey` 的限額及監控。IP 不寫入應用資料表；託管平台存取紀錄依各平台保留政策處理。

## 字型與資源

`public/assets/glyphs.json` 為 Noto Sans CJK TC Medium 的輪廓子集，授權在 `public/assets/OFL.txt`。修改文字後須重建，避免 3D 字元缺漏：

```sh
NOTO_FONT=/absolute/path/NotoSansCJKtc-Medium.otf npm run font
```

原字型：https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/TraditionalChinese

照片出處見 `research/photo-audit.json`、`research/profile-source.json`。原始來源檔保存在本機 `research/source-assets/`，不進入 Git 或部署。公開照片保留來源連結，不作為特定人物完成工程的證據。

視覺方向參考 https://april-zhu.com/colorfigures ，模型與程式為本專案撰寫。資料盤點：https://portaly.cc/hammerlee 。本版對話為中性議題展示，不將競選宣傳主張當作已查證事實。

## 驗證範圍

單元測試涵蓋版本重播、字形洞孔、訊息通知與感應權限、輸入驗證、資料庫請求、轉址、SEO 和社群圖。瀏覽器檢查涵蓋桌面與手機尺寸、人物卡、逐則訊息及分享下載。實體手機的震動、感應器與低階裝置效能仍需實機驗收。
