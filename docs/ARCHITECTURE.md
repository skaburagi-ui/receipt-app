# アーキテクチャと分担（Phase 1：ゲスト版）

要件の正本：`docs/requirements-v3.3.md` ＋ `docs/requirements-v3.4-delta.md`（差分が優先）。
根拠資料：`docs/review/`（税務＝worker-B、Cloudflare＝C1、PDF・印刷＝C2、統合＝00-summary-review.md）。

## 基本方針
- **ブラウザー内で完結**。領収書の内容をサーバーへ送らない。外部通信ゼロ（外部フォント・解析・CDN禁止）。CSPは `public/_headers`。
- プレビュー（SVG）とPDFは**同じ描画リスト**（`DrawOp` / `Page`、`src/domain/types.ts`）から作る。
- 税務ロジックは純粋関数（`src/domain/`）。UIやレイアウトに税務判断を埋め込まない。
- 日本語フォントは `public/fonts/` の静的TTFサブセット（PDF用）とWOFF2（画面用）。

## モジュールと担当（ファイル所有）

| 担当 | 所有ディレクトリ／ファイル | 公開API（スタブは作成済み。実装で置き換える） |
|---|---|---|
| **W1 税務ドメイン** | `src/domain/*`（`types.ts` を除く）、`src/domain/*.test.ts` | `normalizeRegistrationNumber` `validateRegistrationNumber` `calculateTax` `validateReceipt` `hasBlockingIssue` `guideStampDuty` `STAMP_DUTY_TABLE_SALES` `createDefaultReceipt` `applyReceiptDateChange` `todayInJapan` |
| **W2 レイアウト・PDF** | `src/layout/*`、`src/pdf/*`、各テスト | `buildSheet` `pageSizeMm` `imposePages` `pageToSvg` `buildTestPrintPages` `generatePdf` `generatePdfInWorker` |
| **W3 角印・画像・フォント** | `src/seal/*`、`src/image/*`、`public/fonts/*`、`scripts/build-fonts.*`、`docs/font-licenses/` | `buildSealOps` `sealToSvg` `findUnsupportedChars` `whiteToAlpha` `fitWithin` `processUploadedImage` |
| **W4 一括発行** | `src/bulk/*` | `decodeCsvBytes` `parseRecipientsFromCsv` `parseRecipientsFromPaste` `validateRecipients` `normalizeAmount` `buildRecipientCsvTemplate` `assignReceiptNumbers` `sanitizeCsvCell` |
| **W5 UI・下書き** | `src/ui/*`、`src/storage/*`、`src/main.tsx`、`index.html`、`src/styles.css` | 画面一式。上記APIを呼ぶ側 |

- **自分の所有範囲以外のファイルは編集しない。** 他の担当のAPIが未実装でも、契約（シグネチャ）に従って呼ぶ。
- `src/domain/types.ts` は**追加のみ可**（既存項目の削除・意味変更は禁止）。小さな Edit で追記し、下の「型の変更ログ」へ1行書く。
- `package.json` への依存追加は、必要最小限に限る。追加したら理由を完了報告に書く（`npm install <pkg>` は1つずつ、他の担当の作業を壊さない）。
- テストは自分の範囲だけを走らせる（例：`npx vitest run src/domain`）。他の担当が作業中のため、全体の `npm run build` は失敗し得る。
- **git commit・push・デプロイ・アカウント作成はしない。**

## 描画リストの規約
- 座標はmm、原点は左上、yは下向き。テキストは1行ずつ解決済み（折り返し済み）。
- `Sheet`＝領収書1枚（原点はシート左上）。`Page`＝用紙1枚（面付け済み）。
- 用紙：`a4-single` 210×297縦／`a5-single` 210×148横／`a4-double` A4縦に210×148.5を上下／`a4-with-copy` A4縦に上=領収書・下=控え。
- 重要要素は用紙（またはシート）の端から8mm以上内側。
- フォント：`FontRole` = `sans`(Noto Sans JP Regular)／`sansBold`／`serif`(Noto Serif JP Regular)／`serifBold`。ファイル名：`public/fonts/NotoSansJP-Regular.subset.ttf` `NotoSansJP-Bold.subset.ttf` `NotoSerifJP-Regular.subset.ttf` `NotoSerifJP-Bold.subset.ttf`（＋同名 `.woff2`）。

## 領収書シートの内容規約（W2）
- 見出し「領収書」、宛名＋敬称（下線）、領収金額（大きく。「¥1,234-」形式）、但し書き（「但し ○○として」）、「上記正に領収いたしました」、領収日、領収書番号（あれば）、発行者ブロック（名称・〒住所・電話）。
- **一般モード（general）：登録番号を絶対に印字しない**（`issuer.registrationNumber` が入っていても出さない。回帰テスト必須）。「適格請求書ではありません」を `design.showNotInvoiceNotice` に従い小さく表示。税の参考表示は `design.showGeneralTaxReference` に従う（税率別の税込合計・消費税相当額）。「インボイス」「適格」の語は一般モードの出力に含めない。
- **適格請求書（qualified）**：書類名の近くに「適格請求書」、登録番号（T＋13桁）、取引日、宛名、税率ごとの税込（または税抜）合計・税額、軽減税率の「※」と凡例「※は軽減税率対象」。
- **適格簡易請求書（qualifiedSimple）**：登録番号、取引日、税率ごとの合計、**税率または税額**。宛名は任意（空なら「上様」可）。
- 支払方法は `showPaymentMethod` が true のときのみ。備考。収入印紙欄（「収入印紙」と書いた枠）は `showRevenueStampBox` かつ role='original' のときのみ。
- 控え（role='copy'）：「控」表示、同一番号・同一金額、`copyInfo`（発行担当・入金方法・管理用備考）。印紙欄は描かない。
- ロゴ・角印（画像／`buildSealOps`）は `design` に従い配置。デザイン3種（simple／business／casual）は罫線・見出し・フォントの使い方（simple=ゴシック・細罫線、business=明朝見出し・二重罫、casual=ゴシック太字・角丸・テーマカラー面）で区別。テーマカラーは `themeColor`。

## 検証コード（W1が追記）
`validateReceipt` が返す `ValidationIssue.code` の一覧をここへ書く。

`validateReceipt` は法令由来でない基本検証を全モードで行い、モード別の検証を追加する。`hasBlockingIssue` は error が1つでもあれば true。

| code | level | モード | 条件 |
|---|---|---|---|
| `issuer.name.required` | error | 全モード | 発行者名が空（空白のみ含む） |
| `amount.required` | error | 全モード | 領収金額（`calculateTax` の `grandTotalYen`）が0以下 |
| `item.amount.invalid` | error | 全モード | 明細にマイナス・非整数（NaN含む）の金額がある |
| `amount.tooLarge` | error | 全モード | 明細または合計が `9,999,999,999` 円を超える |
| `date.invalid` | error | 全モード | 領収日が空、または領収日・発行日（null以外）・取引日（空以外）が `YYYY-MM-DD` の実在日付でない（`field` で区別） |
| `recipient.empty` | warning | general のみ | 宛名が空（空欄発行も可） |
| `proviso.empty` | warning | general のみ | 但し書きが空 |
| `registration.ignoredInGeneral` | warning | general | `issuer.registrationNumber` が入力されている（一般領収書には印字しない） |
| `registration.required` | error | qualified / qualifiedSimple | 登録番号が空（正規化後に空） |
| `registration.format` | error | qualified / qualifiedSimple | 正規化後に `T`＋13桁の数字でない |
| `registration.checkdigit` | info | qualified / qualifiedSimple | 法人番号の体裁（先頭桁1〜9）で検査用数字が不一致。個人事業者の番号は対象外 |
| `text.registrationLike` | error | general | 自由記述欄に、区切りや全角を正規化すると `T`＋13桁になる文字列がある |
| `transactionDate.required` | error | qualified / qualifiedSimple | 取引日が空 |
| `items.required` | error | qualified / qualifiedSimple | 金額が1円以上の明細がない |
| `confirm.ownRegistration` | error | qualified / qualifiedSimple | `confirmations.ownRegistrationNumber` が false |
| `date.receiptVsTransaction` | info | qualified / qualifiedSimple | 領収日と取引日が異なる（インボイスの年月日は取引日） |
| `recipient.required` | error | qualified のみ | 宛名が空、または「上様」「お客様」「ウエサマ」「御中」「様」「殿」「各位」等の宛名代替語・敬称のみ |
| `proviso.required` | error | qualified / qualifiedSimple | 但し書きが空 |
| `tax.noTaxableItems` | warning / error | qualified / qualifiedSimple | 金額>0の明細はあるが課税明細がない。qualified は warning、qualifiedSimple は error |
| `confirm.simpleEligible` | error | qualifiedSimple のみ | `confirmations.simpleInvoiceEligibleBusiness` が false |
| `proviso.vague` | warning | qualified / qualifiedSimple | 但し書きが「お品代」「代金」「一式」等の曖昧な表現のみ（但し書きが空でないとき） |
| `correction.original.required` | error | 全モード | 訂正書面で元の日付と番号が両方空 |
| `correction.changes.required` | error | qualified / qualifiedSimple | 訂正書面の修正内容が空 |
| `correction.changes.empty` | warning | general | 訂正書面の修正内容が空 |

- qualified で但し書きが空のときは `proviso.required` のみ（`proviso.empty` は出さない）。qualifiedSimple では宛名に関するコード（`recipient.*`）を一切出さない。
- `registration.format` / `registration.checkdigit` は `validateRegistrationNumber` の結果をそのまま含める。

## 型の変更ログ
- 2026-11-05 初版。`DesignSettings.showNotInvoiceNotice` / `showGeneralTaxReference` を追加。
- 2026-11-06 `ReceiptInput.correction`（任意・訂正書面）を追加。

## 完了の定義（各担当共通）
1. 公開APIが実装され、自分の範囲の単体テストが通る（`npx vitest run <自分のディレクトリ>`）。
2. 自分の範囲の型検査が通る（`npx tsc --noEmit` の自分のファイルに関するエラーが0）。
3. 完了報告に、実装したもの・テスト結果・未解決事項・仕様の解釈で迷った点を書く。
