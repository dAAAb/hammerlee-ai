# Third-party notices

本專案自行撰寫的程式碼採 [MIT 授權](../LICENSE)，Copyright (c) 2026 dAAAb。第三方元件、字型與照片保留各自的授權及權利，MIT 不取代下列條件。

核對日期：2026-10-24。版本以本次 `package-lock.json`、已安裝套件的授權檔與來源檔標頭為準。正式建置會將主授權及第三方聲明嵌入產物，透過網站的 `/licenses/` 路徑提供。

## 瀏覽器會用到的程式

| 元件 | 已核對版本 | 授權／權利人 | 本專案用途與完整授權來源 |
| --- | --- | --- | --- |
| Three.js | 0.180.0 / r180 | MIT；© 2010–2025 three.js authors | 3D 場景、幾何、`RoomEnvironment`、`BufferGeometryUtils`、`USDZExporter`。[r180 LICENSE](https://github.com/mrdoob/three.js/blob/r180/LICENSE)，完整正文亦列於下方。 |
| Earcut，隨 Three.js 內含 | 3.0.1 | ISC；© 2024 Mapbox | 幾何三角化。Three 的 `src/extras/lib/earcut.js` 標頭明記版本；不會單獨出現在 npm lockfile。[3.0.1 LICENSE](https://github.com/mapbox/earcut/blob/v3.0.1/LICENSE)，完整正文亦列於下方。 |
| fflate，隨 Three.js USDZ exporter 內含 | 0.8.2 | MIT；© 2023 Arjun Barrett | USDZ ZIP 封裝。Three 的 `examples/jsm/libs/fflate.module.js` 標頭明記版本。[0.8.2 LICENSE](https://github.com/101arrowz/fflate/blob/v0.8.2/LICENSE)，完整正文亦列於下方。 |
| qrcode-generator | 2.0.4 | MIT；© 2009 Kazuhiko Arase | 在本機產生事民卡 QR Code。[上游 LICENSE](https://github.com/kazuhikoarase/qrcode-generator/blob/master/LICENSE)；套件 `dist/qrcode.js` 同樣保留作者及 MIT 標頭。完整正文亦列於下方。 |
| Vite 的產物輔助程式 | 7.3.7 | MIT；© 2019–present VoidZero Inc. and Vite contributors | Vite 本身是建置工具；產物可能含 module-preload 等輔助程式。[7.3.7 完整授權及其內含元件聲明](https://github.com/vitejs/vite/blob/v7.3.7/packages/vite/LICENSE.md)。核心 MIT 正文亦列於下方。 |

Three.js 所帶的其他範例字型、載入器與壓縮器並不因安裝 Three 而全部成為本網站資產。上表列出的是本次從實際 import 路徑及來源標頭確認的部分，並非將整個套件內容宣稱為本專案原創。

## 建置與測試工具

下列套件由 `npm ci` 取得；本倉庫未收錄 `node_modules`。若另行打包或販售含這些工具的原始碼包、容器或開發環境，應保留各套件隨附的完整授權檔，不能只保留本表。套件名稱的連結指向對應版本的發行頁。

| 元件／實際版本 | 授權 | 核對的完整授權檔與備註 |
| --- | --- | --- |
| [jsqr 1.4.0](https://www.npmjs.com/package/jsqr/v/1.4.0) | Apache-2.0 | `node_modules/jsqr/LICENSE`；[上游全文](https://github.com/cozmo/jsQR/blob/master/LICENSE)。只用於測試 QR 解碼，未被 `src/` 匯入；此套件未附獨立 `NOTICE` 檔。 |
| [opentype.js 1.3.4](https://www.npmjs.com/package/opentype.js/v/1.3.4) | MIT | `node_modules/opentype.js/LICENSE`，© 2020 Frederik De Bleser。用於字形資料建置。其 dist 標頭另明載 tiny-inflate 與 codePointAt polyfill。 |
| [tiny-inflate 1.0.3](https://www.npmjs.com/package/tiny-inflate/v/1.0.3) | MIT | `node_modules/tiny-inflate/LICENSE`。 |
| [string.prototype.codepointat 0.2.1](https://www.npmjs.com/package/string.prototype.codepointat/v/0.2.1) | MIT | `node_modules/string.prototype.codepointat/LICENSE-MIT.txt`。 |
| [Vite 7.3.7](https://www.npmjs.com/package/vite/v/7.3.7) | 核心 MIT；內含元件另有 BSD-2-Clause、CC0-1.0、ISC、MIT | `node_modules/vite/LICENSE.md` 含完整內含元件清單及逐項授權；[官方同版本全文](https://github.com/vitejs/vite/blob/v7.3.7/packages/vite/LICENSE.md)。不能把整份檔案簡化成「全部 MIT」。 |
| [Rollup 4.65.0](https://www.npmjs.com/package/rollup/v/4.65.0) | 核心 MIT；內含元件另有 ISC、0BSD 等 | `node_modules/rollup/LICENSE.md` 含完整清單；其中 tslib 為 0BSD。 |
| [esbuild 0.28.2](https://www.npmjs.com/package/esbuild/v/0.28.2) | MIT | `node_modules/esbuild/LICENSE.md`。 |
| [postcss 8.5.31](https://www.npmjs.com/package/postcss/v/8.5.31) | MIT | `node_modules/postcss/LICENSE`。 |
| [fdir 6.5.0](https://www.npmjs.com/package/fdir/v/6.5.0)、[picomatch 4.0.7](https://www.npmjs.com/package/picomatch/v/4.0.7)、[tinyglobby 0.2.17](https://www.npmjs.com/package/tinyglobby/v/0.2.17)、[nanoid 3.3.20](https://www.npmjs.com/package/nanoid/v/3.3.20) | MIT | 各套件根目錄的 `LICENSE`。 |
| [picocolors 1.1.1](https://www.npmjs.com/package/picocolors/v/1.1.1) | ISC | `node_modules/picocolors/LICENSE`。 |
| [source-map-js 1.2.2](https://www.npmjs.com/package/source-map-js/v/1.2.2) | BSD-3-Clause | `node_modules/source-map-js/LICENSE`。 |
| [@types/estree 1.0.9](https://www.npmjs.com/package/@types/estree/v/1.0.9)、[fsevents 2.3.3](https://www.npmjs.com/package/fsevents/v/2.3.3) | MIT | 各套件根目錄的 `LICENSE`；fsevents 為可選平台依賴。 |

Lockfile 另列可選平台套件 `@esbuild/*` 0.28.2、`@rollup/rollup-*` 4.65.0、`@napi-rs/lzma-linux-x64-gnu` 1.5.1，授權欄均為 MIT。本次核對的是 lockfile 及目前平台實際安裝的檔案，沒有逐一下載其他平台二進位，也不把 metadata 檢查等同完整的二進位依賴稽核。

## 伺服器端 SVG 轉 PNG

分享圖 renderer 在伺服器端以 `npm:@resvg/resvg-wasm@2.6.2` 載入，與前端 npm lockfile 分開。其授權為 **MPL-2.0**，不是 MIT。[2.6.2 套件 metadata](https://github.com/thx/resvg-js/blob/v2.6.2/wasm/package.json)、[完整 MPL-2.0](https://github.com/thx/resvg-js/blob/v2.6.2/LICENSE)、[對應來源](https://github.com/thx/resvg-js/tree/v2.6.2)。

本倉庫沒有複製該套件的 JavaScript 或 WASM 二進位；程式在伺服器取得未修改的指定版本，回傳的是 PNG。若日後把 WASM、套件或其修改版本另行隨發行物散布，需保留 MPL 聲明並提供對應 Source Code Form；不要用本專案的主授權覆蓋它。其 Rust 編譯依賴還包含其他元件；[該版本 Cargo.toml](https://github.com/thx/resvg-js/blob/v2.6.2/Cargo.toml) 可見依賴與 patch 來源，但本次沒有完成該預編譯 WASM 的完整 Rust SBOM／每個傳遞依賴的授權驗證。

## 字型與圖像

Noto 字形資料使用 SIL OFL 1.1，照片另有各自權利。請同時保留 [ASSETS.md](ASSETS.md) 與 [OFL 完整正文](../public/assets/OFL.txt)。照片的公開刊登同意不等於授權所有 fork 再散布，不能自動套用程式碼授權。

## 發行時應保留的聲明

- 原始碼發行保留本文件、字型 OFL、資產來源聲明，以及實際散布的套件內附授權／NOTICE。
- 瀏覽器產物在 `/licenses/` 一併提供主授權、本文件的 runtime 授權正文與素材聲明；字型著作權及完整 OFL 同樣隨產物提供。保留這些檔案，不以 minifier 留下的一行連結取代完整授權。
- 若額外散布完整 Vite／Rollup 工具包，保留其完整 `LICENSE.md`，包括上游已收錄的內含元件聲明；本文件沒有逐份重複它們。
- 版本或匯入路徑改變時重新盤點，特別是內含元件、WASM 與新增照片。

## Runtime 授權全文

### Three.js 0.180.0

```text
The MIT License

Copyright © 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Earcut 3.0.1

```text
ISC License

Copyright (c) 2024, Mapbox

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### fflate 0.8.2

```text
MIT License

Copyright (c) 2023 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### qrcode-generator 2.0.4

```text
MIT License

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Vite 7.3.7 core

此段僅是 Vite 核心 MIT；整個 Vite 套件內含的其他元件聲明仍在前述官方完整 `LICENSE.md`。

```text
MIT License

Copyright (c) 2019-present, VoidZero Inc. and Vite contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
