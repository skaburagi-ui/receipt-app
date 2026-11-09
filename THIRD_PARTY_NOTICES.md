# Third-Party Notices

このアプリケーションに同梱・再配布しているサードパーティ資産の一覧です。
（npm 依存ライブラリの表示は、本書後半に記載しています。）

## フォント（public/fonts/）

| フォント | 用途 | ライセンス | 出典 |
|---|---|---|---|
| Noto Sans JP（Regular 400 / Bold 700） | 画面表示・PDF（ゴシック） | SIL Open Font License 1.1 | https://github.com/google/fonts/tree/main/ofl/notosansjp （https://fonts.google.com/noto/specimen/Noto+Sans+JP） |
| Noto Serif JP（Regular 400 / Bold 700） | 画面表示・PDF（明朝）・角印の文字 | SIL Open Font License 1.1 | https://github.com/google/fonts/tree/main/ofl/notoserifjp （https://fonts.google.com/noto/specimen/Noto+Serif+JP） |

### 著作権表示

- Noto Sans JP — Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'.
- Noto Serif JP — Copyright 2012 Google Inc. All Rights Reserved.（フォントファイル内の表記：(c) 2017-2024 Adobe (http://www.adobe.com/).）
- "Noto" は Google Inc. の商標です。

### 改変の旨（サブセット化して再配布）

`public/fonts/` のファイルは、上記フォントの**改変版**です。Google Fonts 公式リポジトリの可変フォント（`NotoSansJP[wght].ttf`／`NotoSerifJP[wght].ttf`）から、次の処理で作成しました。

1. `fontTools.varLib.instancer` で wght=400（Regular）／700（Bold）の静的インスタンスを生成
2. JIS X 0208 全域、ASCII、Latin-1、半角カナ、NEC行13・NEC選定IBM拡張・IBM拡張（髙・﨑 等）、記号類（〒 ① ㈱ ¥ ～ ― 等）に**サブセット化**（収録 7,576 文字。それ以外の文字のグリフは含みません）
3. TTF（PDF 埋め込み用）と WOFF2（画面表示用）で出力。ヒンティングは除去

再現手順：`scripts/build-fonts.py`（入力の google/fonts コミットSHAと取得ファイルのSHA-256を固定）。出力の記録：`public/fonts/BUILD-INFO.json`。

### 予約フォント名（Reserved Font Name）について

- Noto Sans JP の OFL は予約フォント名として **'Source'** を宣言しています。OFL 第3条により、改変版はこの名称を主たるフォント名として使えません。本アプリのサブセット版のフォント名は「Noto Sans JP」「NotoSansJP-Regular」等のままで、**'Source' を名称に含めていません**（ファイル名・内部の family／full name／PostScript name を確認済み）。内部メタデータの著作権表示（name ID 0）と商標表示（name ID 7「Source is a trademark of Adobe…」）に 'Source' の語が残るのは、元のフォントの表示をそのまま保持しているためです（名称としては使っていません）。
- Noto Serif JP の OFL は予約フォント名を宣言していません。
- 改変版は元と同じ名称（Noto Sans JP / Noto Serif JP）のまま配布しています。元の名称を使うこと自体は上記のとおり OFL の禁止対象ではありませんが、これらは**元の配布物とは別物（文字数を絞ったサブセット）**です。完全なフォントが必要な場合は上記の出典から入手してください。
- フォントは単体で販売しません（OFL 第1条）。作者名・著作権者名を、改変版の宣伝・推奨に使いません（第4条）。
- 改変版も OFL 1.1 の下で配布されます（第5条）。OFL 全文は `docs/font-licenses/` と、アプリから参照できる `/licenses/fonts.txt` にあります。

### ライセンス全文

- `docs/font-licenses/NotoSansJP-OFL.txt`
- `docs/font-licenses/NotoSerifJP-OFL.txt`
- アプリ公開用：`public/licenses/fonts.txt`（上記2つを連結。UI から `/licenses/fonts.txt` へ静的リンクする）

OFL に関する FAQ：https://openfontlicense.org

---

## npm 依存パッケージ（本番ビルドに含まれ得るもの）

2026-11-06 時点で、`npm ls --omit=dev --all` の依存（推移依存を含む）のライセンスは次のとおりです。各パッケージのライセンス全文は、`node_modules/<パッケージ名>/LICENSE` にあります。配布物（`dist/`）にライセンス表示を同梱する方法は、公開前に整備してください（未対応）。

| ライセンス | パッケージ |
|---|---|
| MIT | react, react-dom, scheduler, pdfkit, fontkit, papaparse, brotli, base64-js, clone, dfa, fast-deep-equal, restructure, tiny-inflate, unicode-properties, unicode-trie, pako, @noble/ciphers, @noble/hashes, fflate, linebreak, png-js |
| Apache-2.0 | @swc/helpers |
| BlueOak-1.0.0 | sax |

※ `png-js` は package.json にライセンス欄がありませんが、同梱の LICENSE ファイルは MIT です。

依存の増減のたびにこの表を更新してください。
