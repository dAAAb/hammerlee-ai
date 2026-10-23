# 素材來源與使用範圍

更新日期：2026-10-24。本專案自行撰寫的程式碼與原創圖形採 [MIT 授權](../LICENSE)。第三方套件、字型、照片、肖像與品牌各自保留其權利；詳見 [第三方聲明](THIRD_PARTY_NOTICES.md)。

## 照片與肖像

維護者表示已取得團隊同意，供本網站公開使用下列照片。這項網站使用同意**不代表將照片、肖像、姓名或品牌改授為 MIT**。重新部署、修改或散布這些素材的使用者，應另行取得所需權利，或換成自己有權使用的素材。

來源紀錄日期為 2026-10-23；照片轉為 WebP，未以生成式工具改動人物。頭像只在顯示時裁切。

| 檔案 | 來源 |
| --- | --- |
| `public/photos/hammer-profile.webp` | 維護者提供的人像附件。 |
| `public/photos/neighborhood-walk.webp` | [李四川 Hammer Lee 官方 Facebook 公開貼文](https://www.facebook.com/share/p/1AkxNM877p/)。 |
| `public/photos/apartment-elevator.webp` | [李四川 Hammer Lee 官方 Facebook 公開貼文](https://www.facebook.com/share/p/19FhQHJxWv/)。 |
| `public/photos/workplace-childcare.webp` | [李四川 Hammer Lee 官方 Facebook 公開貼文](https://www.facebook.com/share/p/1J924NJpZX/)。 |

`docs/media/desktop.png`、`docs/media/mobile.png` 與 `docs/media/conversation.gif` 是網站展示截圖／錄影，包含上述照片或肖像，**不納入 MIT 素材授權**。截圖或錄影不會改變其中照片、肖像與品牌的權利。

使用者自行拍攝的自拍只供其在瀏覽器內製作本機圖卡，不是倉庫素材，也不因使用本網站而轉授權給本專案。

## 字型與字形輪廓

`public/assets/glyphs.json` 與 `supabase/functions/journeys/og-glyphs.js` 使用 **Noto Sans CJK TC Medium 2.004** 的字形輪廓，依 **SIL Open Font License 1.1** 提供。[官方版本來源](https://github.com/notofonts/noto-cjk/tree/Sans2.004/Sans/OTF/TraditionalChinese) · [著作權與 OFL 全文](../public/assets/OFL.txt)

建置用原始字型的內嵌資訊：

```text
© 2014-2021 Adobe (http://www.adobe.com/).
Noto Sans CJK TC Medium
Version 2.004;hotconv 1.0.118;makeotfexe 2.5.65603
Noto is a trademark of Google Inc.
This Font Software is licensed under the SIL Open Font License, Version 1.1.
```

`scripts/build-font.mjs` 抽取所需字元、轉成路徑並縮放至 1000 單位，再由 `scripts/build-og-glyphs.mjs` 產生分享圖子集；`✳` 與 `↻` 另由幾何程式建立。字形資料及其修改版本保留 OFL 與字型著作權聲明。使用字型排出的普通文字、圖卡或插畫，不因此整體改採 OFL。

## 原創幾何與圖形

- `src/models.js` 以程式建立小人、貼圖、徽章與相機圖示，沒有匯入外部人物或徽章模型。
- `public/assets/ar-cube.svg` 與 `docs/media/cover.svg` 為本專案原創向量圖形，採 MIT。封面使用 Noto 字形路徑排字，屬普通文字繪製，沒有嵌入照片。
- 動態分享圖、事民卡與 USDZ 徽章分別由 `supabase/functions/journeys/og-image.js`、`src/export.js`、`src/badge-usdz.js` 產生。生成程式採 MIT；輸出若含照片、自拍、品牌或第三方素材，仍適用那些素材的權利。

## 設計參考與內容來源

感謝 [April Zhu 的 Color Figures](https://april-zhu.com/colorfigures) 提供柔和色彩與立體視覺方向的靈感。本專案自行實作互動、場景與幾何生成；參考網站的程式、作品與素材不在本專案授權範圍內。

市政議題與經歷資料參考 [李四川 Portaly](https://portaly.cc/hammerlee)、[經歷介紹](https://portaly.cc/hammerlee/pages/about) 及其連結的公開貼文。這些是來源方的公開說明；本網站將其整理成預先編寫的互動展示，不是本人即時對話。來源連結不構成對來源內容或照片的額外授權。
