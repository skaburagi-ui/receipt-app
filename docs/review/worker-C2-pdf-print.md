# C2：PDF生成・印刷方式の技術検証（ブラウザー内完結）

- 作成日：2026-11-05 ／ 対象：`docs/requirements-v3.3.md`（§3-4〜3-8、4、5 Phase 1、6）
- 凡例：【公式】公式ドキュメント・ライセンスで確認／【実測】本検証で使い捨てコードを実行して確認（Windows 11・Node v24.22.0・PyMuPDF描画。**モバイル実機・各ブラウザーでは未実施**）／【二次】公式でない情報／**未確認**＝確認できていない。
- 使い捨てコード・取得フォント・出力PDFは `D:\Temp\claude\c2-spike\`（リポジトリ外）にあり、削除可能。

---

## 0. 要点（結論先出し）

1. **推奨：ブラウザー内で、クライアント側ライブラリ（pdfmake＝pdfkit系）によりPDFを直接生成する。** サーバー側生成はゲスト情報非送信の方針と矛盾するため不採用。ブラウザー印刷（CSS `@page`）は主方式にせず、スパイクS5で比較用に検証する。
2. **pdf-lib は日本語で使わない。** 【実測】`embedFont(…, {subset:true})` で日本語（Noto Sans JP／BIZ UD等）の**グリフが欠落**した。`subset:false` なら正常だがPDFが約3MBになる。pdf-lib本体も最終リリースが2022-05-12。pdfmakeは同条件でサブセット化が正常に動いた。
3. **フォントは静的ウェイトに固定し、JIS X 0208＋NEC/IBM拡張でサブセット化する。** 【実測】Google Fontsの Noto Sans JP は可変フォントで、既定インスタンスが **Thin(100)** のため、そのままPDFに入れると極細文字になる。`fonttools` で wght=400/700 の静的TTFを作ってから使う。
4. 実機で必ず確認すべきなのは「実寸100%印刷」「iOS/Androidでの保存・印刷」「100件生成の実機性能」「プレビューとPDFの一致」。§9にスパイクと合否基準を示す。

---

## 1. PDF生成方式の比較

### 1-1. 比較表

| 観点 | (a) ブラウザー印刷（CSS `@page`＋`window.print()`） | (b) クライアント側ライブラリ（**pdfmake**推奨） | (c) サーバー側（Cloudflare Browser Rendering等） |
|---|---|---|---|
| ゲスト情報を送らない方針 | ◎ 送信なし | ◎ 送信なし（要CSPで担保） | **× 入力HTMLをCloudflareへ送る**（`html`を要求、[PDF endpoint](https://developers.cloudflare.com/browser-rendering/rest-api/pdf-endpoint/)） |
| 実寸・用紙寸法の確実さ | △ 利用者の印刷ダイアログ設定（拡大縮小・余白・ヘッダー/フッター）に依存。`@page size` は Safari/iOS Safari で **18.2以降のみ**対応（[MDN BCD](https://github.com/mdn/browser-compat-data) の `css.at-rules.page.size`、【実測】データ照会）。実際に守られるかは**未確認** | ○ PDF自体の用紙寸法・座標をmm単位で固定できる。印刷時の拡大縮小は閲覧アプリ側に依存（→§3-5） | ◎ 同左（ただし不採用） |
| 日本語・フォント | ○ Webフォントを使う。印刷前にフォント読込完了を保証する必要あり。PDF内のサブセット化の可否は**未確認** | ○ pdfmakeはTTFをサブセット化して埋め込める【実測：1ページ約23KB／100ページ約464KB】 | ○（フォント指定次第） |
| 「PDFとして保存」ボタン | × プログラムからPDFファイルを得られない。ダイアログ経由のみ。iOSは印刷プレビュー→共有→ファイルに保存の手順（【二次】[9to5mac](https://9to5mac.com/2017/04/14/how-to-print-to-pdf-on-iphone-ipad-and-mac/)。Apple公式は**未確認**） | ◎ Blob生成→ダウンロード（`<a download>` はiOS Safari 13以降【実測：BCD】）／Web Share API（`canShare`はiOS 14以降、Chrome Android 75以降）で共有 | ◎ |
| スマートフォン | △ iOS/Androidの印刷UIに依存。拡大縮小の指定が難しい | ○ 生成は端末内。印刷はPDFビューアー／共有シート経由 | ○ |
| 容量（初回ロード） | ◎ ライブラリ不要。ただし日本語Webフォントは必要 | △ pdfmake.min.js 812KB（gzip 285KB）【実測】＋フォント（→§2） | ◎ クライアントは軽い |
| 100件一括 | △ 数百ページのDOMを印刷ダイアログへ渡す。メモリ・描画負荷は**未確認** | ○ Node実測で約1秒（→§4）。モバイルは実機で要確認 | ○ ただし無料枠は後述 |
| コスト | 0 | 0（静的配信のみ。Workers Static Assetsのリクエストは無料・無制限【公式】[billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)） | **無料枠 10分/日、3同時、PDF等のQuick Actionは10秒に1回**／有料は $0.09/時間超過【公式】[pricing](https://developers.cloudflare.com/browser-rendering/pricing/)・[limits](https://developers.cloudflare.com/browser-rendering/platform/limits/)。またWorkers無料枠のCPUは**10ms/リクエスト**【公式】[limits](https://developers.cloudflare.com/workers/platform/limits/)で、Worker内でのPDF生成は現実的でない |
| プレビューとの一致 | ◎ 同一レンダラー（CSS） | △ 別レンダラーになる → §6の対策が必須 | △ 同左 |
| 実装リスク | 印刷設定が利用者任せで品質を保証できない | ライブラリ選定（§1-2）と自前レイアウトの工数 | 方針違反 |

### 1-2. クライアント側ライブラリ比較

| ライブラリ | 状態（npm 2026-11-05時点【実測】） | 日本語サブセット | 備考 |
|---|---|---|---|
| **pdfmake** 0.3.13 | 2026-10-25更新・活発 | ◎【実測】サブセット動作。静的TTFで欠落なし | 低水準描画（canvas）・SVG（SVG-to-PDFKit利用【公式】[svgs](https://pdfmake.github.io/docs/0.3/document-definition-object/svgs/)）・`pageSize:{width,height}`・`pageBreak`あり【公式】[page](https://pdfmake.github.io/docs/0.3/document-definition-object/page/)。クライアント側フォントは`vfs`または`url`方式【公式】[custom-fonts-client-side](https://pdfmake.github.io/docs/0.3/fonts/custom-fonts-client-side/)。各ファミリーに4スタイル指定が必要（同一ファイルを4つに指定可）。Web Worker内動作は**未確認** |
| pdf-lib 1.17.1 | **最終2022-05-12**（保守停滞）。フォークの`@cantoo/pdf-lib` 2.11.1は2026-09-15更新（日本語サブセット不具合の有無は**未確認**） | ×【実測】`subset:true`でグリフ欠落（可変・静的・BIZ UDいずれも）。READMEにも「サブセット化は全フォントで動くわけではない」とある【公式】[README](https://github.com/Hopding/pdf-lib) | 長所：`ViewerPreferences.setPrintScaling(PrintScaling.None)`あり【公式】。SVGは`drawSvgPath`のみ |
| jsPDF 4.2.1 | 2026-03-17更新 | **未確認**（公式READMEにサブセット記載なし） | TTF追加はVFS＋`addFont`【公式】[README](https://github.com/parallax/jsPDF)。SVGは`svg2pdf.js`プラグイン（限定的なSVG仕様のみ対応と明記）。 |
| @react-pdf/renderer 4.9.0 | 2026-08-27更新 | **未確認** | 可変フォントは「正しく動かない」と明記、TTF/WOFFのみ【公式】[fonts](https://react-pdf.org/fonts)。日本語の禁則・改行規則の記載なし（**未確認**）。React依存でプレビューとは別物 |

### 1-3. 推奨（1つ）

**(b) クライアント側生成：pdfmake（内部は pdfkit）＋静的サブセットフォント。** 理由：

- ゲスト情報を端末外へ出さない方針に合致し、ランニングコストが0。
- 【実測】日本語サブセットが正常に動く唯一の候補（pdf-libは不具合、他は未確認）。かつ現在も保守されている。
- 用紙寸法・座標をmm単位で固定でき、「実寸」「改ページ」を利用者の印刷設定に左右されず制御できる。
- 「PDF保存」ボタンを実装できる（(a)では不可）。

併用案：実装初期は **(a) の印刷用CSS版をスパイクS5の比較対象に限定**し、(b)が実機で不合格の場合の代替（フォールバック）とする。本番で2方式を並行運用はしない（二重実装を避ける）。

---

## 2. 日本語フォント

### 2-1. 埋め込み方式

- **サブセット化は可能**：pdfmake（pdfkit）がPDF生成時に使用文字だけを自動サブセット化する【実測：BIZ UDGothic 1ページ23KB、Noto Sans JP 1ページ19KB】。**ただしpdfmake公式ドキュメントにサブセットの明記は無い（未確認＝実測で確認）**。
- 配布するフォントファイルの事前サブセット化（Webアセット用）：`fonttools`（`pyftsubset`）で JIS X 0208全域＋ASCII＋半角カナ＋NEC/IBM拡張（`髙`・`﨑`等）の9,364文字に絞る【実測】。
- **範囲外の文字**（例：`𠮷`、拡張漢字）が入力されたときは、豆腐にせず警告し、必要時に**フルフォントを遅延読込**して再生成する設計にする（フルのNoto Sans JP静的TTFは約5.6MB。Static Assetsの1ファイル上限25MiB以内【公式】[limits](https://developers.cloudflare.com/workers/platform/limits/)）。
- **可変フォントの罠**【実測】：Google Fonts配布の `NotoSansJP[wght].ttf`（9.6MB）／`NotoSerifJP[wght].ttf`（13.6MB）は既定がThin。`fonttools varLib.instancer` で wght=400/700 を固定した静的TTF（Sans 5.6MB／Serif 7.9MB）を作る。pdfkit/fontkit・react-pdf（公式も可変フォント非対応【公式】）ともこの前処理が前提。

### 2-2. ライセンス（公式で確認）

| フォント | ライセンス | 商用・PDF埋め込み・再配布・サブセット | 根拠 |
|---|---|---|---|
| **Noto Sans JP** | SIL OFL 1.1 | 可。改変（サブセット）版もOFLで再配布可。予約フォント名は「Source」のみ宣言、サブセット名に使わない。著作権表示とOFL文の同梱が必要 | [OFL.txt](https://github.com/google/fonts/blob/main/ofl/notosansjp/OFL.txt) |
| **Noto Serif JP** | SIL OFL 1.1 | 同上（OFL.txt冒頭でOFL 1.1を確認。RFNの詳細は未精査） | [OFL.txt](https://github.com/google/fonts/blob/main/ofl/notoserifjp/OFL.txt) |
| **BIZ UDゴシック／UD明朝** | SIL OFL 1.1（予約名なし） | 可 | [gothic](https://github.com/googlefonts/morisawa-biz-ud-gothic/blob/main/OFL.txt)・[mincho](https://github.com/googlefonts/morisawa-biz-ud-mincho/blob/main/OFL.txt) |
| **Zen Kaku Gothic New／Zen Old Mincho** | SIL OFL 1.1（予約名なし） | 可 | [ZKGN](https://github.com/google/fonts/blob/main/ofl/zenkakugothicnew/OFL.txt)・[ZOM](https://github.com/google/fonts/blob/main/ofl/zenoldmincho/OFL.txt) |
| **IPAex ゴシック／明朝** | **IPAフォントライセンス v1.0**（OFLではない） | 商用可（第2条3項）。PDFへの埋め込みは受領者の義務なし（第2条5項）。**改変版（=サブセット）を再配布する場合**は、元フォントに戻す手段（差分ファイル等）の提供、同一条件での配布、元の名称を使わない等の条件がある（第3条）。サブセット化＝改変かは条文解釈で**要法務確認** | [license](https://moji.or.jp/ipafont/license/)（IPAex Ver.004.01、[ゴシック4.0MB・明朝5.3MB zip](https://moji.or.jp/ipafont/ipaex00401/)） |
| Source Han Sans（源ノ角ゴ） | OFL 1.1、予約名「Source」 | 可。ただし「Source Han Sans」名で改変版を配れない | [LICENSE](https://github.com/adobe-fonts/source-han-sans/blob/master/LICENSE.txt) |

- 判断：**OFLのNoto系／BIZ UD／Zenを採用候補とし、サブセット再配布に条件の多いIPAexは避ける。** 法的判断は専門家確認が前提（本書は条文の要約であり法的助言ではない）。
- Zen Maru Gothic は未確認。Noto Serif JP の公式ページ（fonts.google.com の license 画面）は取得不能だったため、GitHubの OFL.txt で代替した。

### 2-4. 静的アセットのサイズ・初回ロード【実測】

JIS X 0208＋拡張（9,364字）に事前サブセット化した結果：

| フォント | フル(TTF) | JISサブセット(TTF) | 同(WOFF2) | サブセットTTFのbrotli |
|---|---|---|---|---|
| Noto Sans JP 400 | 5,631KB | 2,362KB | 1,120KB | 1,280KB |
| Noto Sans JP 700 | 5,626KB | 2,361KB | 1,144KB | — |
| Noto Serif JP 400 | 7,890KB | 3,333KB | 1,514KB | — |
| Noto Serif JP 700 | 7,885KB | 3,331KB | 1,558KB | 1,742KB |
| BIZ UDゴシック Regular | 4,557KB | 2,563KB | 1,558KB | — |
| BIZ UD明朝 Regular | 6,009KB | 3,407KB | 2,054KB | — |
| Zen Kaku Gothic New Regular | 2,304KB | 2,184KB | 995KB | — |
| Zen Old Mincho Regular | 5,314KB | 5,162KB | 1,921KB | — |

- 参考：`@fontsource/noto-sans-jp`（OFL-1.1）はunicode-range分割済みで、400ウェイトのWOFF2が120スライス・合計約2.8MB、平均24KB、最大の日本語スライス1,106KB【実測：jsDelivr API】。画面プレビュー用に使えば、表示する文字分だけ読み込める。
- **方針案**：①プレビュー用にWOFF2（分割）を自己ホスト（Google Fontsの外部読込はIP等が第三者へ渡るため避ける）、②PDF生成時のみ静的TTFサブセット（Sans 400＋700、Serif 700で合計約8MB／brotli後約4.3MB）を初回生成時に取得しService Worker／HTTPキャッシュへ。Static Assetsは無料・無制限【公式】。
- 初回ロード時間は回線・端末依存。**未確認**（スパイクS1で4G相当の速度制限下で計測し、PDF初回生成が「ボタン押下から10秒以内」を目標にする）。

### 2-5. 明朝・ゴシックの使い分け案

- ゴシック（Noto Sans JP）：金額・宛名・住所などの基本表示。 明朝（Noto Serif JP Bold）：「領収書」見出し・角印の文字・「ビジネス」デザイン。デザイン3種（シンプル／ビジネス／カジュアル）の字体はフォントを増やしすぎない（全体で2〜3ファミリー、計約8MB以内）。
- カジュアル用の丸ゴシック（Zen Maru Gothic等）は未確認のため、採用時にライセンスを再確認する。

### 2-6. 旧字体・異体字（髙、﨑等）

- 【実測】Noto Sans/Serif JPは `髙 U+9AD9`・`﨑 U+FA11`・`邉 U+9089`・`𠮷 U+20BB7`・`濵`・`㈱`・`①`・`〒` を**すべて収録**。BIZ UDは `𠮷` のみ欠落。Zen系は `𠮷` と `―` が欠落。cmap format 14（異体字セレクター）は Noto・BIZ UD にあり、Zenは0件。
- → **既定は Noto Sans/Serif JP**（字形網羅性が最良）。BIZ UD/Zenは採用時に旧字体の警告表示が増える。
- 【実測】`髙`は Shift_JIS(CP932)で `EEE0`、`﨑` は `ED95` で表現でき、Excel由来CSVでも保持される（§7）。
- 入力時にフォント非収録文字を検出して警告し（豆腐は印刷事故になる）、宛名はNFC/NFKC正規化を**勝手に行わない**（`髙`が`高`に変わると別字になるため）。異体字セレクター（IVS）付き文字列は pdfkit/fontkit でのGSUB/cmap14処理が**未確認**のため、スパイクS2で検証する。

---

## 3. 用紙寸法・印刷

### 3-1. A4二等分とA5の差

- A4=210×297mm、A5=148×210mm（ISO 216。[Markus Kuhn解説](https://www.cl.cam.ac.uk/~mgk25/iso-paper.html)ほか【二次】。規格原文は**未取得**）。
- A4を上下に二等分すると **210×148.5mm**。これは**A5横置き（210×148mm）と0.5mm差**でほぼ同じ。**A5縦（148×210）ではない**（向きが90°違う）。
- 要件の「③ A4：2件上下」の各1件は、正確には「**A4横分割（210×148.5）**」。②「A5：1件」の向き（横が自然）を要件で明記する必要がある（→§10）。
- 「②A5」と「③の1件」は210×148／148.5でほぼ同じレイアウトを共用できる（差0.5mmは吸収）。

### 3-2. A5を1枚だけ印刷するときの注意

- PDFのページを A5（`210×148`横 または `148×210`縦）にする。プリンターにA5が用紙設定として無い／手差ししか無い機種では、ブラウザー・ビューアーが拡大縮小したり、A4に配置したりする。→「A5が使えない場合はA4に印刷してA5分だけ切る（③と同じ裁断）」を案内する選択肢を用意する。
- 利用者向けの案内：用紙サイズ「A5」、拡大縮小「なし／100%／実際のサイズ」、「ページに合わせる」はOFF。A5紙の給紙方向（長辺/短辺送り）で向きが90°変わることがある（機種依存、**未確認**）。

### 3-3. 余白・非印字領域

- プリンターの印字不可領域は機種依存。Brotherの公式ページではA4で上下左右とも最大4.2mm【公式】[例：HL-3220CW](https://support.brother.com/g/s/id/htmldoc/printer/cv_hll3220cw/fre/html/GUID-1BBF837B-7708-4FCB-8F03-EBC668571B9F_1.html)（他社・他機種は**未確認**。ページ内にもアプリにより異なる旨の注記あり）。
- 設計方針：**文字・罫線・角印などの重要要素は用紙端から8mm以上内側**（最低6mm）。裁断ガイド（トンボ）も端から5〜8mmの範囲に収め、印字不可領域に入れない。A4上下2件の中央（148.5mm）は印字可能領域内なので分割線は問題ない。
- スパイクS3で実機プリンターの実際の欠けを測り、最終値を確定する。

### 3-4. 裁断ガイド

- A4二等分：y=148.5mmに破線（全幅）、または左右余白に短いトンボ（長さ4〜5mm）。「表示/非表示」切替。破線が領収書の枠内に食い込まない余白（上下各4mm以上）を確保する。
- 控え付き（④）：領収書と控えの間に「切り取り線」ラベル。切り離した控えにも同一番号・金額を保持する（§3-6）。

### 3-5. 「実寸100%」を守らせる方法

PDF直接生成が(a)より有利な点だが、**最終的な拡大縮小は閲覧・印刷アプリの設定次第**。多層で対策する：

1. **PDFの `/ViewerPreferences /PrintScaling /None` を設定**（アクロバット系の「既定の印刷スケール」を「なし」にする仕様）。pdf-libには`setPrintScaling(PrintScaling.None)`がある【公式】。pdfmakeでの直接設定可否は**未確認**。→ pdfmake出力をpdf-lib（またはフォーク）で後処理する案を検討。後処理でも欠落バグが出ないか（フォント非関与のため出ない見込み）はスパイクS1で確認。各ビューアー（Acrobat、Chrome、Edge、Safari、iOS、Android）が尊重するかは**未確認**（S3）。
2. **実寸確認用の「試し刷りページ」**（100mmの目盛・50×50mm角・端から3/5/8/10mmの枠）をワンクリックで出力。定規で測る手順を案内。ズレが±1mm超なら設定を見直す案内。
3. 印刷ボタン周辺に環境別の短い手順（PC：「拡大縮小：実際のサイズ/100%」「ヘッダーとフッター：OFF」／スマホ：印刷プレビューでの倍率確認）。
4. 領収書本体は端から8mm以上内側に置き、多少のプリンター側縮小があっても欠けない設計にする。

### 3-6. スマートフォンからの印刷

- iOS Safari：`window.print()`は使えるが、PDF保存は印刷プレビュー→共有の経由（【二次】）。生成PDFは`<a download>`（iOS 13以降）またはWeb Share API（`canShare` iOS 14以降）で「ファイルに保存／共有」へ渡す。AirPrintで直接印刷する際の用紙・倍率の細かい指定は機種・iOS版で異なる（**未確認**）。
- Android Chrome：`window.print()`あり（BCD：Chrome Android 18以降）。印刷サービス経由。`@page size`の効きはChrome Androidで対応版あり（BCD）だが、実際の用紙指定は**未確認**。
- File System Access API（`showSaveFilePicker`）は**Safari・Firefox非対応**（BCD）→使わない。
- 現実的な導線：スマホでは「PDFを保存→コンビニ（ネットプリント等）／PC・別アプリから印刷」を主導線として案内する。直接印刷は「できる場合もある」扱い（実機検証後に確定）。

---

## 4. 改ページ・一括

### 4-1. 処理時間・メモリ【実測：Node v24・デスクトップ、PDF直接描画のみ。ブラウザー・モバイルは未実施】

単純な領収書（見出し・宛名・金額・但し書き・住所・透過PNG角印1枚、罫線）での値：

| 条件 | ページ | 時間 | PDF容量 | RSS |
|---|---|---|---|---|
| pdfmake・BIZ UDゴシック 100件(1件/ページ) | 100 | 約0.96秒 | 464KB | 164MB |
| pdfmake・Noto Sans JP(可変) 100件 | 100 | 約0.98秒 | 462KB | 141MB |
| pdfmake・1件 | 1 | 約0.07秒 | 19〜23KB | 78〜83MB |
| pdf-lib・A4上下2件・100件（ただし欠落バグあり） | 50 | 約0.2秒 | 64KB | 117MB |
| pdf-lib・領収書＋控え・500件 | 500 | 約1.1秒 | 481KB | 182MB |

- Nodeの素の基準RSSは約78MB（1件時）。100件で＋60〜85MB程度の増加。
- 実アプリはレイアウト（税率別内訳・複数明細・ロゴ・印紙欄）が重くなり、スマホはデスクトップより数倍遅いと見込む（**根拠のない見込みであり、S6で実測**）。
- → 100件は十分現実的と**見込む**が、上限（暫定：1回300件）はS6の実測で確定する。

### 4-2. Web Worker

- 100件規模でも、モバイルでは数秒〜十数秒の主スレッド占有が起こり得るため**Workerを推奨**（進捗表示・キャンセル）。20〜30件ごとにチャンクしてUIを返す案もある。
- pdfmake 0.3 のWorker内動作、`SVGElement`入力（DOM必要）の回避（文字列SVGを渡す）は**未確認**。S1・S6で確認。`OffscreenCanvas`はSafari 16.4以降（BCD）。

### 4-3. 改ページの確実な方法

- **1シート＝1つの固定レイアウト単位**（絶対座標）として描画し、ライブラリの自動フロー改ページに頼らない（長文でシートが2ページにまたがる事故を防ぐ）。pdfmakeでは`pageBreak:'before'`で明示するか、低水準描画で各ページを構成する。
- 内容が枠を超える場合のポリシー（自動で最小フォントまで縮小→まだ溢れるなら警告し発行を止める）を決める。
- ブラウザー印刷(a)を使う場合：`break-after: page`はChrome 50／Firefox 65／Safari 10以降で対応（BCD）。シート高さを297mmちょうどにすると端数で空白ページが出る事例があるため少し小さくする（**未確認**。S5で確認）。

### 4-4. 奇数件・控え

- ③（A4上下2件）：奇数件は最終ページの下半分を空欄（何も描かない）。裁断ガイドは「下半分が空でも表示するか」を設定可能に。
- ④（領収書＋控え）：1件＝1ページ（上：領収書、下：控え）。控え側のみ発行担当・入金方法・管理用備考を描画。100件なら100ページで奇数問題は生じない。

---

## 5. 印影・ロゴ

### 5-1. 埋め込み品質・画像処理

- 透過PNGは pdfmake/pdfkit でアルファ（SMask）付きで埋め込まれる。【実測】透過PNGの角印を白紙上に配置し、PyMuPDF描画で透過部が白紙として正常に見えた。**文字や罫線の上に重ねた場合の見え方、乗算ブレンドの可否は未確認**（S8）。
- **アップロード上限案**：ファイル5MB、縮小後は角印の長辺800px（約25mm角で約800dpi相当）、ロゴは長辺1200px。縮小は`createImageBitmap(blob,{resizeWidth,…})`で行い巨大なcanvasを作らない（iOS Safariのcanvas面積上限が16,777,216pxと報告されている【二次】[pqina](https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/)。iOS 18で拡大の報告あり、一次情報は**未確認**）。`createImageBitmap`はSafari 15以降（BCD）。
- 再エンコード（canvas→PNG）でEXIF（位置情報など）が落ちる利点もある。向き補正を確認する。HEICの扱い（iOSは`<input type=file>`でJPEG変換されることがある）は**未確認**。
- PDF内の画像は同一画像を1度だけ登録して使い回す設計にする（pdfmake`images`辞書。重複排除の挙動は**未確認**）。

### 5-2. 背景透過の自動処理

- 実装可能：白背景のスキャン画像で「輝度→アルファ」変換（白をα=0、インク色を朱色に寄せる）＋しきい値スライダー＋チェッカー盤プレビュー。ブラウザー内canvasで完結。
- 注意：紙の質感・影・JPEGノイズ・色付き背景・ロゴの白抜き部分は誤判定する。**結果の目視確認を必須にし**、自動でうまくいかない場合は「透過PNGを使う」案内を出す。高度な自動切り抜き（ML）は容量・過剰設計のため見送る。

### 5-3. 角印のアプリ内作成

- **方式案：SVGで生成し、文字は字形アウトライン（パス）に変換してから描画**する。文字のままSVG `<text>`にするとPDFビューアー・フォント環境で見た目が変わる。パス化すればPDFでも**ベクターのまま保持**でき、拡大しても滑らか（pdfkit/pdfmake側の描画はパス命令。実機確認はS8）。字形抽出は fontkit（glyph.path）または opentype.js 2.0.0（2026-05更新）【実測：npm】。
- **縦書き・二段組みの難しさ**：①canvasの`fillText`は縦書き非対応。SVGの`writing-mode`はChrome 48／Firefox 41／Safari 10.1以降で対応（BCD）だが、PDF側（pdfkit）の縦書き対応は**未確認**。②句読点・長音「ー」・括弧は縦書き専用字形（GSUB `vert`）が必要。fontkit/opentype.jsのvert対応は**未確認**。③角印は文字数が少ない（2〜6字）ので、**1文字ずつ格子セルに配置**する自前方式が最も確実。
- 設計案：レイアウトを限定（1×2縦、2×2、2×3、3×3等。右列上から下→左列の順）、各文字をセルいっぱいに拡縮、枠は二重線／角丸、朱色（#C8161D付近）。書体は太明朝（Noto Serif JP 700）。篆書体風は無料ライセンスの候補を**未確認**のため、「印鑑風だが篆書体ではない」と明記し、期待値を管理する。
- 法的な電子署名や本人認証とは区別する旨をUIに表示（§3-5既定）。

---

## 6. リアルタイムプレビューとPDFの一致

### 6-1. リスク

- HTML/CSSプレビュー＋pdfmake（別レンダラー）だと、**改行位置・文字幅・行間・余白・丸め・フォント代替**がずれる。三方式の実装（3デザイン×4印刷形式）を二重に保守することになり、バグ原因になる。

### 6-2. 対策（推奨順）

1. **共通レイアウトエンジン方式（推奨）**：入力→「表示リスト」（mm単位の絶対座標。text/line/rect/path/image）を1つの関数で生成。フォント計測・改行（禁則は簡易自前実装）もこのエンジンで行い、**プレビューは表示リストをSVGで描画、PDFは同じ表示リストをpdfmake低水準描画で出力**。両者はレイアウトを共有し、描画だけが別になるので差は小さい。フォント計測はPDF側と同じfontkitを使う。
2. **PDFをそのままプレビューにする方式（代替）**：生成したPDFをpdf.js等で表示（完全一致）。ただし更新が重く（デバウンス要）、pdf.jsのモバイル性能・容量は**未確認**。
3. ブラウザー印刷(a)に一本化すれば同一レンダラーだが、§1の理由で主方式にしない。
- 対策の検証：自動テスト（Playwrightで表示リストSVGをPNG化、PDFをMuPDF/pdf.jsでPNG化して差分）。S7参照。pdfmakeの自動フロー（段落の自動改行）は使わず、座標描画に統一する。

---

## 7. CSV・貼り付け

- **ブラウザー内で完結できる**（`<input type=file>`→`File.arrayBuffer()`→デコード→パース。サーバー送信なし）。
- **文字コード判定**（Excel「CSV」＝Shift_JIS(CP932)、「CSV UTF-8」＝BOM付き）：①先頭BOM `EF BB BF`→UTF-8、`FF FE`→UTF-16LE（Excelの「Unicodeテキスト」）。②`new TextDecoder('utf-8',{fatal:true})`で試し、例外なら`new TextDecoder('shift_jis')`。【実測】CP932で保存したCSVはUTF-8デコード不可（`fatal`で例外＝判別可能）、`shift_jis`デコードで `髙橋`・`﨑`・`①㈱` が正しく復元された（Node v24。WHATWG Encodingではshift_jis/windows-31j等が同一の「Shift_JIS」で、IBM/NEC拡張を含む【公式】[Encoding Standard](https://encoding.spec.whatwg.org/#names-and-labels)。**各ブラウザーでの動作は未確認**＝S9）。
- **パース**：Papa Parse 5.7.0（MIT）。文字列を自分でデコードして渡す（`encoding`オプションは`FileReader`向けでShift_JISの扱いが公式に明記されていないため【公式】[docs](https://www.papaparse.com/docs)）。【実測】文字列先頭のBOMは除去され、ヘッダーに残らない。
- **TSV貼り付け**：Excelのコピーは「タブ区切り＋セル内改行は引用符」。【実測】自動判定は1行目だけの小さな入力で失敗する場合があった（`delimiter`未指定でヘッダーが1列に結合）。→ 貼り付け入力は**区切り文字を明示（タブ）**する。引用符内改行は`header:true`で正しく解釈される【実測】。
- **不正値対策**：金額は全角数字・カンマ・「円」・「¥」を正規化後に整数検証（空・負数・小数・桁あふれは行ごとにエラー）。制御文字除去、長さ制限、ファイルサイズ・行数上限（暫定5MB／300行）、重複・空欄を一覧で警告（§3-8要件）。名前だけの一致で既存データを上書きしない（Phase 2以降）。
- **数式インジェクション（=、+、-、@）**：Phase 1は読み込みのみで、読み込んだ値はPDF・画面に文字列として出力するため実害は生じない。**CSVエクスポート／テンプレート出力（Phase 2）では必須**：OWASPはセル先頭の `= + - @`、Tab、CR、LFを要注意とし、全角 `＝ ＋ － ＠` も日本語ロケールで数式扱いされ得ると述べる【公式】[OWASP](https://owasp.org/www-community/attacks/CSV_Injection)。Papa `unparse` の `escapeFormulae` は `= + - @ \t \r` に先頭`'`付与で、**全角やLFは対象外**【公式docs＋実測：`＝1`は未エスケープ】→全角・LFも含める独自処理が必要。電話番号の先頭`+`・`-`など正当な値も影響するため、エクスポート時のみ適用し、利用者に注記する。

---

## 8. ブラウザー内下書き保存

- **容量**：localStorageは1オリジン約5MiB【公式】[MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)（同ページ内に10MiBの記述もあり不整合）。IndexedDBはChromiumでディスクの最大60%、Safari（ブラウザーアプリ）で約60%、Firefoxで最大10%または10GiB（best-effort）【公式】同MDN・[WebKit 2023](https://webkit.org/blog/14403/updates-to-storage-policy/)。画像（印影・ロゴ）を含むため**IndexedDB（Blob）**を使う。設定の小物のみlocalStorage。
- **消去リスク**：
  - **Safari「7日ルール」**：クロスサイト追跡防止が有効なとき、サイトとのユーザー操作が7日間（Safari使用日ベース）無いと、IndexedDB・localStorage等のスクリプト書き込みストレージが削除される【公式】[WebKit 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)、MDN（2026-01更新）も現行仕様として記載。ホーム画面に追加したWebアプリは別カウントで削除されないと想定されている（同WebKit記事）。**「単なる閲覧だけでカウントが戻るか」は未確認**（記事は「ユーザー操作」としている）。
  - ストレージ逼迫時はbest-effortデータがLRUで削除され得る。`navigator.storage.persist()`で永続化を要求できるが、承認はブラウザーの判断（Safari 15.2以降、Chrome 55以降、BCD）。
  - プライベートブラウズ・サイトデータ削除・ブラウザー再インストールで消える。プライベートモードの扱いはここでは**未確認**。
- **個人情報を端末に残すことの注意**：
  - **既定はOFF**。「この端末のこのブラウザーにだけ保存します。共有・職場・ネットカフェのPCでは使わないでください」と保存時に明示し、**「すべて削除」ボタン**と最終保存日時、**自動期限（例：30日で削除）**を設ける。
  - 一括発行の宛先リスト（個人情報が多い）は下書きに含めるか別途確認する。既定は含めない。
  - JSで暗号化しても鍵を同じ端末に置けば保護にならない。安全の根拠は「端末内のみ」「保存しない」ことで、「暗号化されているから安全」とは案内しない。
  - 長期保管の手段は**下書きのJSONファイル書き出し／読み込み**を案内（Safari消去対策）。
- **利用者向け案内文の例**：「下書きは、お使いの端末・ブラウザーの中にだけ保存されます（サーバーには送りません）。Safariでは約1週間このサイトを使わないと消えることがあります。大切な内容はファイルに書き出して保管してください。」
- XSS対策としてCSP（`default-src 'self'`、`connect-src 'self'`、サードパーティースクリプト・解析タグなし）を徹底する（下書き・入力内容を第三者スクリプトに読ませない）。

---

## 9. 結論とスパイク

### 9-1. Phase 1で採用するPDF方式

**ブラウザー内PDF生成：pdfmake（pdfkit）＋静的TTFサブセット（Noto Sans/Serif JP）＋共通レイアウトエンジン（表示リスト）、Web Worker実行、必要ならpdf-lib（またはフォーク）で`PrintScaling None`を後付け。** サーバーには何も送らない。

### 9-2. 実装前に必ず行う技術スパイク（実機・合否基準）

実機候補：iPhone（iOS最新と1つ前）／Android（中位機種）／Windows（Chrome・Edge・Firefox）／macOS（Safari・Chrome）。プリンター：家庭用インクジェット1台以上、レーザー1台、可能ならコンビニのネットプリント。

| # | 検証 | 手順 | 合否基準 |
|---|---|---|---|
| S1 | 生成・保存の基本動作 | 使い捨てページでpdfmake＋静的サブセットTTFにより、領収書1件をWorker内で生成→ダウンロード／共有。pdf-lib後処理で`PrintScaling None`付与も試す | 全環境で生成成功・保存できる。1件が中位スマホで3秒以内。後処理後もグリフ欠落なし。pdfmakeがWorker内で動く |
| S2 | 日本語グリフ・異体字 | テスト文字列（`髙﨑邉𠮷㈱①〒ー、。「」～―¥`、IVS付き文字、長い但し書き60字）を明朝・ゴシックで出力し、Acrobat／Chrome／Edge／macOSプレビュー／iOS／Androidで表示。テキストのコピー・検索も確認 | 豆腐・欠落ゼロ（範囲外文字は警告が出る）。禁則・折り返しが意図どおり |
| S3 | **実寸印刷** | 試し刷りPDF（外枠210×148.5、100mm目盛、端から3/5/8/10mmの枠）を、Acrobat（実際のサイズ）／Chrome既定／Edge／iOS印刷／Android印刷で各プリンターへ出力。定規・ノギスで測定。`PrintScaling None`の有無でも比較 | 100mm目盛が99〜101mm。A4二等分で上下とも148.5±1mm。8mm枠が全辺で欠けない（欠けるなら安全余白を拡大）。ビューアー別の尊重可否を表に記録 |
| S4 | A5単票・A4フォールバック | A5給紙対応機でA5 PDF。A5非対応機でA4に出す導線 | 向き・寸法が正しい、または案内どおりのフォールバックが成立 |
| S5 | ブラウザー印刷(a)の比較 | 同一レイアウトをCSS（`@page size`、`break-after`）で作り`window.print()`。ヘッダー/フッター・余白・寸法を各ブラウザーで測定 | (b)不合格時の代替として採用可能か判定：寸法±1mm、ページ数が想定どおり（空白ページなし） |
| S6 | 100件・300件の負荷 | 実機ブラウザーで100件／300件を生成。時間・ピークメモリ（DevTools／Safari Web Inspector）、UI応答、タブ落ちを記録 | 100件が20秒以内、UI停止が200ms以内（Worker）、OOM・タブクラッシュなし。300件は成否で上限件数を決定 |
| S7 | プレビューとPDFの一致 | 50ケース（長い宛名、長い但し書き、複数明細、各印刷形式）で、SVGプレビュー画面とPDF描画（pdf.js／MuPDF）をPNG化して差分比較 | 要素位置差0.3mm以内、改行位置100%一致、はみ出し判定が一致 |
| S8 | 印影・ロゴ・角印 | 透過PNG、白背景JPG、12MP／48MPのスマホ写真、HEICを読込→縮小→PDF埋め込み。背景透過のしきい値処理。角印（1×2、2×2、2×3）をパス化してPDFに入れ、800%拡大で確認。文字・罫線との重なりも確認 | 巨大画像でもiOSでメモリ不足にならない。角印がPDF内でパス（ベクター）として保持され、拡大しても滑らか。縦書き配置が人の目視で許容（長音・括弧を含む） |
| S9 | CSV・貼り付け | Windows Excel CSV(CP932)／CSV UTF-8(BOM)／UTF-16テキスト／Mac Excel／Numbers／Google Sheets／LibreOfficeの出力、セル内改行、`=cmd`等を各ブラウザー（特にiOS Safari）で読込。Excelからのコピー貼り付け | 文字化けゼロ、`髙﨑①㈱`が保持される、不正値が行単位で警告される、数式風文字列が文字列のまま扱われる |
| S10 | 下書き保存 | iOS Safariで保存→8日以上放置（操作なし）→消えるか。ホーム画面追加時、Chromeのpersist、プライベートモードも確認。**最長8日かかるため最初に着手** | 消える条件が案内文と一致。復元・全削除・ファイル書き出し／読込が動作 |
| S11 | 通信非送信の担保 | 入力〜PDF生成〜下書き保存の間、DevTools／プロキシで外部通信を観察。CSPで`connect-src 'self'`を設定 | 個人情報を含むリクエストが0件（フォント・ライブラリは自サイト静的資産のみ） |

進め方：S10は最初に開始、S1→S2→S3→S6の順で行い、S3の結果で安全余白とPrintScaling対策を確定してからデザイン実装へ進む。S1・S2で不合格ならpdfkitを直接使う案、またはS5の(a)案へ切り替える。

---

## 10. 要件定義書への修正・追記案

### §3-6（印刷形式）

1. **各形式の寸法を明記**：①A4=210×297mm（縦）、②A5の向き（横210×148mm／縦148×210mmのどちらか。人間の判断が必要。推奨：横）、③A4=上下2件＝各**210×148.5mmのA4横分割**（A5縦ではない。A5横210×148mmとは0.5mm差）、④同分割＋控え。
2. 「実寸印刷に対応」を**受け入れ基準化**：PDF用紙寸法は規定値と一致、実寸印刷時の100mm目盛実測が±1mm以内、重要要素は用紙端から8mm以上（最低6mm）、最終値は実機検証（S3）で確定。
3. 「PDFと実際の印刷結果の一致」について、**拡大縮小は閲覧・印刷アプリの設定に依存し完全には保証できない**ことを明記し、対策（PrintScaling指定、試し刷りページ、利用者向け手順）を要件に加える。
4. 「印刷時に入力フォームなどの画面要素を出力しない」→ PDF直接生成方式では自動的に満たされる旨を明記（ブラウザー印刷用CSSは不要。比較・フォールバックとして使う場合のみ必要）。
5. 「改ページによる崩れを防止」→ 1シート＝固定レイアウト、内容が収まらない場合の方針（自動縮小の下限／警告して発行を止める）を明記。
6. 「A5：1件」で用紙が使えない場合のA4フォールバックを選択肢として追記。
7. 裁断ガイド：位置（印字可能領域内）と、ガイド非表示時の動作を明記。奇数件の「下半分を空欄」に「裁断ガイドも描画するか」を追記。
8. 日本語字形：フォント非収録文字（旧字体・異体字・拡張漢字）の検出・警告方針を追記。宛名の文字を自動で正規化（髙→高など）しないことを明記。
9. 一括発行（§3-8に関連）：1回あたりの上限件数（暫定300件、実測後に確定）、CSVはShift_JIS／UTF-8（BOM有無）対応、貼り付けはタブ区切り、不正値・数式文字列の扱いを追記。
10. 印影・ロゴ（§3-5に関連）：アップロード上限（暫定5MB・縮小後長辺800/1200px）、背景透過は「補助機能で、結果の確認が必須」、角印は文字配置パターンを限定し「印鑑風（篆書体ではない）」であることを追記。
11. 下書き保存（§3-1に関連）：既定OFF、保存対象と期限、「すべて削除」、Safariでの消去、共有端末への注意、ファイル書き出しを追記。

### §6（技術方針）

1. 「ブラウザー内PDF生成とサーバー側PDF生成の比較」に**結論を記載**：Phase 1はブラウザー内生成（pdfmake系）。サーバー側（Browser Rendering）は、入力HTMLをCloudflareへ送るためゲスト非送信方針と矛盾し、無料枠も「10分/日」「Quick Action 10秒に1回」で現実的でないため不採用。Workers無料枠のCPUは10ms/リクエストでPDF生成を載せられない。
2. **ライブラリ選定の注意を追記**：pdf-libは日本語サブセットで欠落が発生し最終リリースが2022年のため不採用。可変フォントは使えず静的ウェイトに変換が必要。
3. 検討事項の2に**フォント方針**（静的TTF／JIS＋NEC/IBM拡張のサブセット、OFLのみ採用、ライセンス全文同梱、自己ホスト）、検討事項の4に**目標値**（100件が20秒以内、上限件数）を追記。
4. 検討事項の5に「プレビューとPDFを同一の表示リストから生成する（二重実装の回避）」を追記。
5. 検討事項の9に**CSP（`connect-src 'self'`、サードパーティースクリプト禁止）と、通信非送信の検証手順（S11）**を追記。Google Fontsなど外部フォント配信は使わない。
6. 検討事項10に、スマホの保存・印刷導線（ダウンロード／共有シート／ネットプリント）と、iOS/Androidでの制約の実機検証（S1・S3）を追記。
7. **Phase 1の完了条件に「§9のスパイクS1〜S11の合格」を追加**。Cloudflareへの限定テスト公開時に、実機での実寸印刷結果の記録を残す。
8. 「Static Assetsの無料・無制限（リクエスト）、1ファイル25MiB・無料プランで20,000ファイル」を前提としてフォント配信を設計（総サイズ上限は**未確認**）。

---

## 参考URL（一覧）

- フォント：[Noto Sans JP OFL](https://github.com/google/fonts/blob/main/ofl/notosansjp/OFL.txt)／[Noto Serif JP OFL](https://github.com/google/fonts/blob/main/ofl/notoserifjp/OFL.txt)／[BIZ UD](https://github.com/googlefonts/morisawa-biz-ud-gothic)／[Zen](https://github.com/google/fonts/tree/main/ofl/zenkakugothicnew)／[IPAex](https://moji.or.jp/ipafont/license/)
- PDFライブラリ：[pdf-lib](https://github.com/Hopding/pdf-lib)／[pdfmake fonts](https://pdfmake.github.io/docs/0.3/fonts/custom-fonts-client-side/)／[jsPDF](https://github.com/parallax/jsPDF)／[react-pdf fonts](https://react-pdf.org/fonts)
- ブラウザー互換：[MDN @page](https://developer.mozilla.org/en-US/docs/Web/CSS/@page)／[caniuse](https://caniuse.com/css-paged-media)（Safari/iOS 18.2以降で`@page`対応と表示）／[MDN BCD](https://github.com/mdn/browser-compat-data)
- ストレージ：[WebKit 2020](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)／[WebKit 2023](https://webkit.org/blog/14403/updates-to-storage-policy/)／[MDN Storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- Cloudflare：[Browser Rendering pricing](https://developers.cloudflare.com/browser-rendering/pricing/)／[limits](https://developers.cloudflare.com/browser-rendering/platform/limits/)／[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)／[Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- CSV：[OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection)／[Papa Parse](https://www.papaparse.com/docs)／[Encoding Standard](https://encoding.spec.whatwg.org/#names-and-labels)

## 未確認の主な項目

Apple公式の印刷手順、Chrome公式の印刷ドキュメント（404）、各PDFビューアーのPrintScaling尊重、`@page size`の実際の印刷挙動（Safari 18.2以降の実機）、pdfmakeのWorker内動作、jsPDF／react-pdfの日本語サブセット・禁則、`@cantoo/pdf-lib`のサブセット不具合の有無、IVSのGSUB処理、モバイル実機での生成時間・メモリ、プライベートモードのストレージ挙動、Zen Maru Gothicのライセンス、他社プリンターの非印字領域。
