# 正式站與 Supabase 資安檢查

日期：2026-10-24（臺灣時間）。起始版本 `8d92015`。範圍為 hammerlee.ai、對應的 Supabase 專案、分享與本機自拍流程；未檢查其他網域或其他專案。

## 修正

| 項目 | 原本的風險 | 本次處理 |
| --- | --- | --- |
| 分享網址 | 將目前網址直接交給分享功能，可能附帶額外 fragment 或預覽網域。 | 只從驗證過的版本與編號產生正式站網址；原始 query、fragment、帳密及其他網域不會被轉送。 |
| 新資料庫物件 | postgres 建立的 public 物件會自動授予訪客權限，後續開發若漏設 RLS 可能暴露資料。現有表並未暴露。 | 新表、序列及函式預設關閉，再逐項授權。移除新函式的全域 PUBLIC EXECUTE 預設值。既有權限及平台管理的 schema 保持原狀。 |
| 外站嵌入與來源資訊 | 缺少防嵌入標頭；同源請求的 Referer 可帶入分享編號。 | 增加 CSP frame-ancestors、X-Frame-Options 及 no-referrer，保留本站選擇性相機使用。 |
| 新增配額 | 同一個 IPv6 /64 的不同暫時位址可各用一份新增配額。 | HMAC 前依 /64 分組；IPv4 仍依位址。只保存每日 HMAC，不保存原始 IP 或網段。共享網路也會共享配額。 |
| 自拍生命週期 | 製卡後的暫存畫布依賴垃圾回收釋放。未發現上傳路徑。 | 成功、取消與失敗都清除額外畫布像素；補上分享圖卡與分享連結的隱私差別。 |

## 實際權限與資料流

- `journeys` 及兩張內部表均啟用 RLS。`anon`、`authenticated` 無法直接讀寫旅程、使用 private schema 或執行內部 RPC。函式採 invoker 權限及固定 search_path，沒有繞過 RLS 的應用程式 definer 函式。
- 伺服器對旅程僅有讀取、新增權限；更新另由 immutable trigger 阻擋。公開 API 不接受自訂對話、照片或使用者資料，只接受版本與編號。
- 公開 bucket 僅供分享預覽 PNG 下載，限制 1 MiB、image/png；沒有訪客上傳、更新、刪除或列出物件的 policy。匿名列出回傳空陣列。公開 OG 是預寫內容，並非自拍。
- 自拍相機在明確點擊後才請求，音訊關閉；拍攝、取消、切到背景及延遲回來的相機授權都會停止串流。照片經 canvas 合成為 PNG，不讀取原始照片檔或 EXIF，也不送到資料庫、Storage、GA 或分享網址。
- 分享連結是公開重播連結，知道網址的人可以看到同一份預寫劇本、官方照片與徽章；它不是私人通訊或存取密碼。自行把含自拍的下載圖卡傳給別人，收件者就能看到自拍。
- GA 程式只送正規首頁網址與固定事件名稱，不送編號、台詞、自拍或偏好；本次從正確網站串流的管理介面確認「加強型評估」已關閉。基礎設施服務仍可能保存一般請求記錄；本次未調整其保留期間。

## 驗證與限制

- 108 項自動測試通過，包含分享網址排除私密參數、自拍成功／取消／失敗清理、IPv6 配額識別與各路由安全標頭；正式產物建置成功。
- 以公開金鑰進行少量 HTTP 檢查：直接讀表、內部 RPC、缺少／偽造代理密鑰都被拒絕；跨來源寫入、自拍額外欄位、畸形分享網址均被拒絕。
- 既有編號仍可讀取及重送，回傳 `created: false`；同一編號的重播 metadata 與已儲存 OG 正常。沒有以真實自拍做測試，也沒有大量掃描或壓力測試。
- 交易內實際建立測試表、序列及函式，驗證三種 API 角色均無預設權限，最後整筆 rollback。可重跑 [SQL 權限測試](../supabase/tests/security.sql)。
- Supabase 安全建議沒有 ERROR/WARN，只剩三項 [RLS 已啟用但無 policy 的 INFO](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。這是僅允許伺服器存取的刻意設定，不應新增寬鬆 policy 來消除提示。
- 這是有範圍的程式碼、實際權限及 HTTP 檢查，不是完整滲透測試。公開讀取與既有編號重送尚無逐請求的應用層限速；新增配額不能當作全面抗 DDoS。未測試瀏覽器／作業系統漏洞或外部帳號遭入侵的情境。

依據：[Supabase Data API 權限文件](https://supabase.com/docs/guides/api/securing-your-api)、[Storage 存取控制](https://supabase.com/docs/guides/storage/security/access-control)。
