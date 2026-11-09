# C1：Cloudflare構成・認証・コストの最新仕様による検証

- 対象：`docs/requirements-v3.3.md`（特に §3-1, 3-10, 3-12, 5, 6, 7）
- 確認日：**2026-11-05**（以下、特記なき事実はすべて同日に公式ページで確認。括弧内は当該ページの「最終更新」表示）
- 調査方法：公式ドキュメントを取得ツール経由で読み、その要約を元に記述。数値は取得結果の転記。**「未確認」＝公式ページで確認できなかったもの**（一般知識で補っていない）。
- 「試算」「推定」「仮定」と書いたものは私の計算・推論であり、公式の事実ではない。

---

## 結論（先に）

1. **Phase 1は Workers + Static Assets の静的配信のみで、無料のまま運営できる。** 静的アセットのリクエストは無料・無制限。新規採用は Pages ではなく Workers（公式推奨）。
2. **Phase 2は D1＋単一Worker（API）で足りる。** 連番は「D1の `batch()`（トランザクション）＋ユニーク制約＋冪等キー」で実現できる見込みだが、**`UPDATE…RETURNING` と日付関数は公式で未確認**なのでスパイク必須。
3. **無料運営の最初の壁は「メール送信」と「D1の無料DB容量500MB」。** Cloudflare自身のメール送信は **Workers Paid限定のβ**で、無料では使えない。Resend無料は**月3,000通・日100通**。
4. **無料枠の最大の運用リスクは濫用。** D1無料枠の日次書き込み上限（10万行/日）を超えると**サービス全体のD1クエリがエラー**になる。会員ごと100件/日の上限だけでは防げない（§7参照）。
5. 認証：**Arctic（2026年7月）とLucia（2025年3月）は非推奨**。Better Auth（安定版1.7系）＋D1が第一候補、自前最小実装が代替。Clerk等のホスト型は非推奨（プライバシー・外部依存）。

---

## 1. Phase 1：Workers + Static Assets

| 項目 | 内容 | 出典 |
|---|---|---|
| 無料プランのリクエスト | 10万/日（UTC 0時リセット）。超過は Error 1027 | https://developers.cloudflare.com/workers/platform/limits/ (2026-10-29) |
| 静的アセットのリクエスト | 「free and unlimited」 | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ (2026-11-03) / https://developers.cloudflare.com/workers/platform/pricing/ (2026-10-02) |
| 静的アセットのファイル数 | 無料 20,000／有料 100,000（Wrangler 4.34.0以上） | limits ページ |
| 1ファイルの最大サイズ | **25 MiB**（無料・有料共通） | limits ページ |
| 帯域・エグレス | 「追加料金なし」の記述あり。ただしこの文は有料プランの段落にあり、**無料プランについて明示した記述は未確認** | pricing ページ |
| アセット保管料 | 追加費用なし | pricing ページ |
| 既知の制約 | `Range` リクエストに 206 でなく 200＋全体を返す | billing-and-limitations ページ |
| 注意（無料） | `run_worker_first` パターンに一致するリクエストは Worker 実行として数えられ、無料上限超過時は 429（静的へのフォールバックなし） | billing-and-limitations ページ（取得時の要約） |
| Workers Caching 有効時 | 静的アセットのキャッシュヒットも課金対象 | 同上 |

**日本語フォント**
- 1ファイル25 MiB以内・合計20,000ファイル以内が制約。通常のサブセット済みWebフォントなら制約にはならない。
- **日本語フォントの実ファイルサイズ（フルセット／サブセット）は公式で確認していない（未確認）。** 実測すること（スパイクS1）。フルのTTFを配信する場合は25 MiB制限と転送量（初回表示の遅さ）に注意。
- 推奨方針（設計判断）：フォントは自サイトの静的アセットとして配信（外部CDN・Google Fontsは使わない。ゲストのIPなどを第三者に送らない：§6-9）。PDF生成時はブラウザ内でサブセット化して埋め込む。

**Pages か Workers Static Assets か**
- 公式の現在の推奨は **Workers**。Pagesの索引に「Are you sure you want to use Pages?」「Workers supports most Pages use cases and offers a broader feature set」「Start new projects with Workers」とある。https://developers.cloudflare.com/pages/ (2026-08-25)
- 「deprecated」「maintenance」の語は読んだページには**なし**（Pagesは引き続き利用可能）。ただしCron Triggers・Workers Logs・Tail Workers・Gradual Deployments等はPagesに無い。Durable ObjectsもWorkers側が「simpler and recommended」。https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/ (2026-10-12)
- Pages無料枠：20,000ファイル、25 MiB/ファイル、ビルド500回/月。https://developers.cloudflare.com/pages/platform/limits/ (2026-09-05)
- **提案：新規は Workers + Static Assets に決定。** Phase 2でAPIを同一Workerに足すだけで済み、作り直しがない。

---

## 2. Phase 2：データ層（D1）と連番採番

### 2-1. D1 の無料枠・上限
出典：https://developers.cloudflare.com/d1/platform/pricing/ ・ https://developers.cloudflare.com/d1/platform/limits/ （いずれも2026-10-30）

| 項目 | 無料 | 有料（Workers Paid） |
|---|---|---|
| 行読み取り | 500万/日 | 月250億まで込み、超過 $0.001/百万行 |
| 行書き込み | **10万/日** | 月5,000万まで込み、超過 $1.00/百万行 |
| 総ストレージ | 5 GB | 5 GB込み、超過 $0.75/GB-月 |
| **1DBの最大サイズ** | **500 MB** | 10 GB（増枠不可と明記） |
| DB数 | 10 | 10万まで込み |
| Time Travel | **7日** | 30日 |
| 1回のWorker実行あたりのD1クエリ | 50 | 1,000 |
| 行/文字列/BLOBの最大 | 2,000,000バイト | 同左 |
| SQL文長 | 100 KB | 同左 |
| バインド変数 | 100/クエリ | 同左 |
| クエリ最大時間 | 30秒（`batch`全体にも適用） | 同左 |

- 日次上限はUTC 0時リセット（＝**日本時間9時**）。無料の上限到達時は「D1 APIがエラーを返す」＝**サービスのD1利用が全面停止**。
- 行読み取りは「返した行」でなく「走査した行」で数える。インデックス設計必須。
- **同時書き込みの性質**：「各D1データベースは本質的にシングルスレッドで、クエリを1つずつ処理する」。平均1msなら最大約1,000件/秒、100msなら約10件/秒。過負荷時は "overloaded" エラー。→ 本アプリ規模（書き込みはせいぜい数件/秒）では問題にならないが、**書き込みは直列化される**という性質が採番の安全性の根拠になる。
- 同時接続は1実行あたり6。`batch()` は上記クエリ数制限の上で1クエリとして数える。**バッチ内の最大ステートメント数は未確認。**
- **DBをユーザーごとに分ける設計は不可**（無料はDB 10個まで）。単一DB＋`user_id`で分離する。

### 2-2. 連番（発行者ごと・欠番/重複なし）と1日100件判定
確認できた事実：
- `batch()` は「トランザクション。1文でも失敗すれば全体をロールバック」「各文は逐次・非並行に実行・コミット」。https://developers.cloudflare.com/d1/worker-api/d1-database/ (2026-10-30確認)
- 明示的な `BEGIN TRANSACTION` は**サポートが確認できない**（インポート時に除去を指示、"cannot start a transaction within a transaction" エラーの記載）。→ 複数文の原子性は `batch()` で取る。
- 外部キーは常時強制。`ON DELETE CASCADE` 利用可。https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- 書き込みを含むクエリはD1が自動リトライしない（リリースノート 2025-09-11）。→ クライアント側リトライ時の二重発行に備え冪等キーが必要。https://developers.cloudflare.com/d1/platform/release-notes/
- **未確認**：`UPDATE … RETURNING`（D1ドキュメントに記載なし。SQLite本体は3.35.0以降で対応 https://www.sqlite.org/lang_returning.html だが、D1のSQLiteバージョンは公式未記載）。`batch()` 実行中に他リクエストのクエリが割り込まないことの明記も**未確認**（「逐次・非並行」の記述のみ）。D1にカウンタ採番の公式サンプルも未確認。
- 「強い整合性・トランザクションが必要ならDurable Objects」というCloudflareの位置づけ：https://developers.cloudflare.com/workers/platform/storage-options/

**推奨方式（案A：D1のみ。第一候補）** ※`RETURNING` に依存しない設計
1. `issuers.next_number`（整数）を持つ。
2. 発行確定時、**1回の `batch()`** に次を入れる：
   (a) `INSERT OR IGNORE INTO daily_usage(user_id, date_jst, count) VALUES(?,?,0)`
   (b) `UPDATE daily_usage SET count = count + :n WHERE user_id=? AND date_jst=? AND count + :n <= 100`（上限判定をSQL内で行う）
   (c) `UPDATE issuers SET next_number = next_number + :n WHERE id=? AND user_id=? AND <(b)が成功した条件>`
   (d) `INSERT INTO receipts(…, number) SELECT …, (採番後の値から計算) …`（一括はn行、番号は base＋連番）
   (e) 冪等キー（クライアント生成UUID）に `UNIQUE(user_id, idempotency_key)`、番号に `UNIQUE(issuer_id, number)` を付け、**最後の安全網**にする。
3. 上限超過時は(b)が0行更新→後続が条件で0行になる、またはユニーク制約違反で**バッチ全体がロールバック**＝欠番を作らない。アプリは結果の `changes` を見て成功/上限超過を判定。
4. 「(b)の成否を後続文の条件にする」手段（`changes()` 関数、条件付きINSERT…SELECT等）がD1で動くかは**未確認→スパイクS2**。
- **一括100件**：上記を1バッチ（n=100）で行い、全件成功か全件失敗にする。バッチ内最大文数・30秒上限は未確認のため、上限に当たる場合は20〜25件ずつに分割（分割時は「途中までで止まる」ことを仕様化）。
- 取消した番号は再利用しない（番号は消費済みのまま `status=canceled`）。再印刷は採番しない。§3-10と整合。

**案B（フォールバック）：会員ごとのDurable Object（SQLiteバックエンド）で採番・日次カウント**
- 無料プランでも利用可（SQLiteバックエンドのみ）：10万リクエスト/日、行書き込み10万/日 等。https://developers.cloudflare.com/durable-objects/platform/pricing/ (2026-10-18)
- 1オブジェクトあたり 1,000 req/秒のソフトリミット。https://developers.cloudflare.com/durable-objects/platform/limits/ (2026-10-29)
- 利点：コード内で条件分岐でき、厳密な直列化が明確。欠点：データが D1 と DO に分かれ、履歴検索・エクスポートが複雑化。**案Aが検証で通らなかった場合のみ採用。**

**日本時間の日次集計**
- 保存は `issued_at`（UTCエポック）に加え、**アプリ側で計算した `issue_date_jst`（`YYYY-MM-DD`）列**を持つ。日本はDSTなしなので UTC+9h で確定。SQLiteの日付関数（`'+9 hours'` 等）は構文上は有効だが（https://sqlite.org/lang_datefunc.html）、**D1での動作は公式ドキュメントに記載なし＝未確認**のため、DB側の日付関数に依存しない。
- 日次カウントは上記 `daily_usage(user_id, date_jst, count)` で原子的に管理（履歴を毎回COUNTしない＝行読み取りも節約）。
- 注意：Cloudflare自身の日次クォータはUTC 0時（JST 9時）リセット。アプリの日次（JST 0時）とは別物なので混同しない。

---

## 3. 画像保存（ロゴ・印影）

- D1は1行/BLOBが最大 **2,000,000バイト**。クライアント側で縮小・圧縮（例：長辺〜400px、PNG/WebP、**上限300 KB程度**に制限。数値は設計案）すればD1のBLOB（別テーブル `assets`）で足りる。一覧クエリに画像列を含めない。
- **ただし容量が効く**：無料のD1は**1DB 500 MB**まで（上表）。画像を発行者ごと1〜2点保存＋「発行時点の再現」のためスナップショットを持つなら、利用者増で圧迫する。→ 内容ハッシュ（SHA-256）で重複排除した `assets` テーブルに入れ、領収書は参照で持つ。将来R2へ移す場合に `assets` の実体だけ差し替えられる抽象化にする。
- R2：無料枠 **10 GB-月、Class A 100万/月、Class B 1,000万/月**、エグレス無料。https://developers.cloudflare.com/r2/pricing/ (2026-10-30)。**無料アカウントでR2を有効化するのに支払い方法が必要かは公式ページで確認できず（未確認）。** 課金に関わるため、人間の承認事項として確認が必要（スパイクS8）。
- **提案：Phase 2はD1 BLOB（上限付き）で開始、`assets`を抽象化。D1が200〜300MBに近づいたらR2へ移行。** Phase 1（サーバー保存なし）では画像はブラウザ内のみ（ローカル保存はIndexedDB/データURL）。

---

## 4. 認証

### 4-(a) メール認証コードの送信手段
**Cloudflare Email Service（Email Sending）**
- 現状：**Beta、Workers Paid限定**。「Arbitrary-recipient sending requires Workers Paid」。GA表記は**確認できず**。https://developers.cloudflare.com/email-service/ (2026-10-15)
- 料金：無料プランは**「Not available」**。Paid は月3,000通込み、超過 $0.35/1,000通。https://developers.cloudflare.com/email-service/platform/pricing/ (2026-06-09)
- 条件：送信ドメインのオンボーディング（SPF/DKIM、DMARC推奨）が必要。オンボード前は検証済み宛先にのみ送信可。Workersバインディング（`send_email`）またはREST/SMTP。https://developers.cloudflare.com/email-service/platform/limits/ (2026-10-30)
- 制限：宛先50/通、25 MiB/通。**新規アカウントの日次クォータは「保守的に開始し徐々に拡大」とあるだけで数値の記載なし（未確認）**。OTP用途の明示的な言及も確認できず。
- 旧 Email Workers の `send_email`（検証済み宛先のみ）の説明は、現在は上記 Email Sending のページに置き換わっている。

**外部サービス比較（2026-11-05確認、USD）**

| サービス | 無料枠 | 有料の入口 | 備考／出典 |
|---|---|---|---|
| **Resend** | 月3,000通・**日100通**・ドメイン3・ログ30日 | Pro $20/月＝5万通（超過 $0.90/1,000） | 独自ドメイン可。Workers用ドキュメントあり。https://resend.com/pricing ・ https://resend.com/docs/send-with-cloudflare-workers |
| Postmark | 月100通 | $15/月＝1万通 | カード不要。https://postmarkapp.com/pricing |
| Mailgun | 日100通・ドメイン1 | $15/月＝1万通 | https://www.mailgun.com/pricing/ |
| MailerSend | 月500通 | Hobby $7/月＝5,000通 | **無料でもカード必須**。https://www.mailersend.com/pricing |
| Amazon SES | 固定の無料枠は価格ページに記載なし（新規は最大$200のクレジット） | Essentials $0.16/1,000 | https://aws.amazon.com/ses/pricing/ |
| Brevo | **未確認**（ページが取得できず） | 未確認 | https://www.brevo.com/pricing/ |

- いずれも日本宛送信の制限は確認できなかった（未確認ではなく「記載なし」）。
- **提案：Phase 2の開始は Resend 無料（独自ドメイン必須）。** 送信は `EmailSender` インターフェースの裏に隠し、Cloudflare Email Sending がGAになり無料/低価格で使える時点で差し替え可能にする。注意点：**日100通の上限**に達するとログイン不能になる → Googleログイン併用、セッションを長め（例：30日）、連続送信の抑制、上限接近の監視。
- **独自ドメインが前提**（どの手段でも送信ドメイン認証が必要）。ドメイン取得費用は本調査対象外（未確認）。

### 4-(b) Googleログイン（OAuth/OIDC）
- **Arctic：READMEに「deprecated on July 2026」**とあり、置き換え用サンプルコードを案内（Google対応はREADMEからは未確認）。https://github.com/pilcrowOnPaper/arctic
- **Lucia：「deprecated in March 2025」**。後継として単一ファイル `auth_session.ts`（Web Crypto のみ、セッショントークン＝id＋32バイト乱数、DBにはSHA-256のみ保存、Cookieは `HttpOnly; Secure; SameSite=Lax`）を公開。https://lucia-auth.com/ ・ https://raw.githubusercontent.com/lucia-auth/lucia/refs/heads/main/code/auth_session.ts
- **Oslo（`@oslojs/*`）**：依存ゼロ、暗号・エンコード・OTP・JWTの部品群。`@oslojs/oauth2` は応答パースのみで、認可URL生成・トークン交換は自前。https://oslojs.dev/
- **Better Auth**：email OTP プラグイン（既定：6桁、有効5分、試行3回、`allowedAttempts` の同時リクエスト突破は1.7.16で修正）、Google ソーシャル（`clientId/clientSecret`、リダイレクト `/api/auth/callback/google`）、D1 は Kysely 経由（`database: env.DB`、組み込みKyselyアダプタのみ `getMigrations` 可）。最新安定は **v1.7.17（2026-11-04）**、1.8.0-beta は破壊的変更を含むため避ける。https://www.better-auth.com/docs/plugins/email-otp ・ https://www.better-auth.com/docs/authentication/google ・ https://www.better-auth.com/docs/concepts/database ・ https://github.com/better-auth/better-auth/releases
  - Better Auth の Cloudflare 専用ガイド（/docs/integrations/cloudflare）は404で**未確認**。Workers無料プラン（CPU 10ms・サブリクエスト50）での実測は未確認（スパイクS3）。
- **Auth.js**：「Better Auth の一部になった」と公式サイトに明記。新規採用は不適。https://authjs.dev/
- **@hono/oauth-providers**（`googleAuth`）：Workersで使えるが、セッションやOTPは自前。メンテ状況は未確認。https://github.com/honojs/middleware/tree/main/packages/oauth-providers

### 4-(c) セッション・ブルートフォース対策・方式比較
- **セッション**：サーバー側セッション（D1の `sessions` テーブルにトークンのハッシュを保存）＋Cookie（`__Host-` 接頭辞、`HttpOnly; Secure; SameSite=Lax`）。即時失効（退会・全端末ログアウト）が可能。CSRF対策（`Sec-Fetch-Site` / Origin検査）を入れる。
- **KVを不採用とする理由**：無料は書き込み1,000/日・同一キー1回/秒、書き込みの反映に最大60秒かかり得る（`cacheTtl` の記述）。即時失効に不向き。https://developers.cloudflare.com/kv/platform/pricing/ ・ https://developers.cloudflare.com/kv/platform/limits/ (2026-10-30)。D1のセッション読み取り（1クエリ/リクエスト）は500万行/日に対し余裕。
- **Turnstile**：無料は「ウィジェット20個、チャレンジ無制限」。https://developers.cloudflare.com/turnstile/plans/ (2026-08-14)。サーバー側検証（siteverify）の必須性・トークン有効期間(300秒)・単回使用は**公式ページ未読のため未確認**（スパイクS5）。**コード送信リクエストと新規登録前**に付ける。
- **レート制限**
  - Workers Rate Limiting バインディング：期間は10秒または60秒のみ、**ロケーションごとの概算・結果整合**で、厳密にはDurable Objectsを使えと書かれている。無料プランでの利用可否・料金は**ページに記載なし（未確認）**。https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ (2026-10-21)
  - WAFレート制限ルール：無料は**1ルール・期間10秒・IP単位**。https://developers.cloudflare.com/waf/rate-limiting-rules/ (2026-08-25)
  - → 厳密に守りたいもの（OTP試行回数、メール宛先ごとの送信回数）は**D1のテーブルで管理**（OTP1件あたり試行5回以内、同一宛先は例：1時間5通、IP単位はTurnstile＋WAF1ルール）。
- **方式比較**

| 方式 | 長所 | 短所 | 判定 |
|---|---|---|---|
| **Better Auth＋D1** | OTP・Google・セッション・アカウント連携が揃う。セキュリティ実装を自作しない | 依存が大きい、1.8で破壊的変更、無料CPU 10msでの挙動未確認、スキーマ自動検証 | **第一候補（要スパイクS3）** |
| 自前最小（Lucia単一ファイル＋Oslo＋Google OIDC手書き） | 依存最小、Workers向きで軽い | 認証コードの保守責任を負う。OTP・同一メールのOTP/Google統合・IDトークン検証を自作 | 代替案（S3が不合格の場合） |
| Clerk（Hobby：5万MRU、メールコード・Google可）／Auth0（2.5万MAU無料） | 実装最小 | 会員メールが外部に出る、外部依存、方針（§6「不要な外部サービスを採用しない」）に反する | 非推奨 |
| Firebase Auth／Supabase Auth | 無料枠大（各5万MAU） | 第二の基盤が増え、Supabase無料はプロジェクト休止あり。D1と二重管理 | 非推奨 |
| Cloudflare Access | — | 自社アプリの会員ログイン用ではなく、アプリの入口制限用 | 不適（Phase 1のテスト公開の限定には使える可能性あり：未検証） |

出典：https://clerk.com/pricing ・ https://auth0.com/pricing ・ https://firebase.google.com/pricing ・ https://supabase.com/pricing ・ https://developers.cloudflare.com/cloudflare-one/policies/access/

- 設計上の重要点：**同一メールアドレスでOTPとGoogleの両方でログインした場合に同一会員として扱う**（Googleの `email_verified` が真の場合のみ統合）。別会員として分かれると発行履歴が分断される。
- 無料プランのCPUは**1リクエスト10ms**（ネットワーク/D1待ちは含まない）。認証が重いワークロードは10〜20msになり得るとの記載があり、超過は Error 1102。https://developers.cloudflare.com/workers/platform/limits/

---

## 5. データ分離・削除・バックアップ

**会員間のデータ分離**（D1に行レベルセキュリティ等の機能は確認できず＝アプリ側で担保）
- **全クエリを `Repository` 層経由に限定**し、各メソッドの引数に必ず `userId`（セッションから取得、リクエストボディから取らない）を要求。ハンドラから生SQLを直接発行しない（lintで禁止）。
- すべてのテーブルに `user_id` 列、全 `WHERE` に `user_id = ?`。**複合外部キー**（例：`receipts(issuer_id, user_id)` → `issuers(id, user_id)`）で、他会員の発行者を参照する行を作れなくする。
- 他会員のIDを指定したテスト（認可テスト）を必須化。IDは推測困難なUUID/ULID。
- 将来の共同管理（§5「将来の機能」）に備え、`issuers` に `owner_user_id` を持たせ、権限は `issuer_members(issuer_id, user_id, role)` を後から足せる形にする（Phase 2では所有者1名のみ）。

**削除（退会）**
- 外部キー `ON DELETE CASCADE` が使える（強制は常時ON）。ただし大量の `DELETE` は約1,000行ずつに分割するよう公式が推奨。https://developers.cloudflare.com/d1/platform/limits/ (2026-10-30)。退会処理は「ソフト削除→Cronで段階的にハード削除」とする（Cron Triggerは無料で5個まで。https://developers.cloudflare.com/workers/configuration/cron-triggers/ (2026-10-17)）。
- 画像（`assets`）・セッション・OTP・ログも対象に漏れなく含める。**削除対象一覧をテーブル定義と同時に管理**。

**バックアップ・復元**
- **Time Travel**：分単位で過去へ復元。無料7日／有料30日、追加費用なし。`wrangler d1 time-travel restore` は**DB全体を上書き**し、実行中のクエリは中断される。https://developers.cloudflare.com/d1/reference/time-travel/ (2026-10-30)。→ 会員単位の部分復元はできない（**個別復元の手順は未確認**。スパイクS6）。
- **エクスポート**：`wrangler d1 export --remote`。仮想テーブル（FTS5等）は不可、**実行中は他のDBリクエストをブロック**、64bit整数の精度劣化に注意。https://developers.cloudflare.com/d1/best-practices/import-export-data/
- 7日/30日を超える保管は、定期エクスポートを R2 に保存するWorkflows例がドキュメントに案内されている（https://developers.cloudflare.com/workflows/examples/backup-d1/ ※リンクのみ確認、**内容は未読**）。
- **削除とバックアップの矛盾**：退会後もTime Travel（7〜30日）やエクスポートに個人情報が残る。**プライバシーポリシーに保持期間を明記**し、復元後は「削除ログ（会員IDのみ）」を再適用して退会済み会員を再削除する手順を用意する。
- **運営者の閲覧（§7）**：D1はCloudflareのダッシュボード/wranglerを持つ人なら全データを閲覧できる。「通常は閲覧しない」は**技術的強制ではなく運用ルール**になる。サポート閲覧は管理画面経由に限定し、アクセス範囲・期限・操作履歴をアプリ側で記録（Cloudflare側の監査ログ機能は未確認）。

---

## 6. コスト試算

### 前提（仮定。実測ではない）
- 月間利用者＝100／1,000／10,000人、1人月10件発行 → **1,000／1万／10万件/月**。
- 1件発行あたり書き込み約5行（領収書、連番更新、日次カウント、インデックス等。**仮定**）、1人月あたりAPI呼び出し約70回、ログイン（OTPメール）月4回（**仮定**）。
- 領収書1件あたりD1容量 約3〜5 KB（スナップショットJSON＋インデックス。**仮定**）。画像は別。

### 無料枠に対する試算
| 指標 | 100人 | 1,000人 | 10,000人 | 無料上限 |
|---|---|---|---|---|
| 書き込み行/日（平均） | 約170 | 約1,700 | 約1.7万 | 10万/日 |
| APIリクエスト/日（平均） | 約230 | 約2,300 | 約2.3万 | 10万/日（ピークは数倍。10,000人でもピーク時の余裕は小さくなる） |
| OTPメール/月 | 400 | 4,000 | 4万 | Resend無料：月3,000・**日100** |
| D1容量増加/月 | 約5 MB | 約50 MB | 約500 MB | **1DB 500 MB（無料）** |

### 概算コスト（USD/月、独自ドメイン費は除く）
| 規模 | Cloudflare | メール | 合計の目安 |
|---|---|---|---|
| 100人 | $0 | $0（Resend無料） | **$0** |
| 1,000人 | $0〜$5（D1容量が約10か月で500MBに到達見込み。または日100通を超えるため） | メールが月4,000通で無料枠超過。Resend Pro $20、または月のログイン回数を抑えて無料に収める | **$0〜$25** |
| 10,000人 | Workers Paid $5（D1容量・ピーク時リクエスト・CPU余裕のため。D1の読み書きは込み枠内の見込み） | Resend Pro $20（4万通）／Cloudflare Email Sending利用なら (40,000−3,000)÷1,000×$0.35＝約$13 | **約$18〜$25** |

- Cloudflare Workers Paid：月最低$5、リクエスト1,000万/月込み（超過 $0.30/百万）。https://developers.cloudflare.com/workers/platform/pricing/
- **無料のまま運営できる上限の目安**：最初に当たる壁は ①メール（日100通＝約750人がログイン月4回の場合）、②D1の1DB 500MB（容量。保持する領収書が約10万件＝1万人×10件なら約5か月分）、③Workersの10万リクエスト/日（API中心で数万人規模）の順。**無料運営の現実的な目安は「数百〜1,000人程度、かつ保存期間が長くなる前」**。
- **有料への移行の境界**：D1が約400MBを超える／メール日100通・月3,000通を超える／サブリクエスト50・CPU 10msを超える機能（大きな一括処理）を入れる／Cloudflare Email Sendingを使う（Workers Paid必須）。D1の1DBは**有料でも上限10GBで増枠不可**（それ以降は分割が必要なため、将来のシャーディングを妨げないIDを使う）。
- **濫用シナリオ（重要）**：無料会員1,000件のアカウントがそれぞれ100件/日発行すると、約5行×10万件＝50万行/日 → **D1無料の書き込み上限(10万/日)を超え、全会員が影響を受ける**。会員ごとの100件制限だけではサービス全体の保護にならないため、**新規登録のTurnstile・メール確認・登録レート制限・全体の日次書き込みの監視**が必要。

---

## 7. 濫用対策

**Phase 1（静的配信のみ）：ほぼ不要**
- 静的アセットのリクエストは無料・無制限で、サーバーに保存するデータも書き込みAPIもない。**濫用されてもコストは増えず、データも漏れない。**
- 必要なのは次の最小限のみ：①ブラウザ内処理に徹する（領収書の内容をサーバーへ送信しない）、②外部スクリプト・外部フォント・アナリティクスを入れない（入れる場合は内容を送らない設計と同意）、③CSP（Content-Security-Policy）の設定（`_headers` で可。100ルールまで）、④サーバー側PDF生成など動的処理を足さない（足すと濫用対象になる）。
- Phase 1で `run_worker_first` を使うと無料のWorkerリクエスト上限(10万/日)の対象になるため、**Phase 1は使わない**（Worker無し、アセットのみ）。

**Phase 2のAPI**
- Turnstile：コード送信、Google以外の新規登録、一括発行、CSVインポート。
- レート制限（D1管理）：メール宛先別（1時間5通）、OTP試行（コード毎5回）、IP別（Turnstile＋WAF 1ルール）、会員別の一括発行・CSVサイズ上限（例：1回100件、CSV 1MB。数値は設計案）。
- 画像アップロードのサイズ上限・MIME検査（SVGは受け付けない/サニタイズ）。
- D1の日次書き込み使用量を監視し、閾値で新規登録を一時停止できる運用スイッチを用意（Phase 3の費用監視）。

---

## 8. 技術構成の提案（Phase 1〜3を通して作り直しを避ける最小構成）

| 層 | Phase 1 | Phase 2 | Phase 3 |
|---|---|---|---|
| 配信 | **Workers + Static Assets**（Workerコード無し） | 同一Worker（`/api/*` のみ `run_worker_first`）。静的は無料のまま | 同左 |
| フロント | React＋Vite（SPA）、ブラウザ内PDF生成、フォントは自前配信 | 同左 | 同左＋管理画面（同一アプリ内のロールで分離） |
| API | なし | Hono（Workers）＋Repository層（userId強制） | 同左 |
| DB | なし（下書きはlocalStorage/IndexedDBでユーザー明示時のみ） | **D1（1DB）**。画像は `assets` テーブル（D1 BLOB、上限付き） | 容量次第でR2、定期エクスポート |
| 認証 | なし | Better Auth(1.7系)＋D1（代替：自前最小）。D1 `sessions` | 管理者ロール、操作履歴 |
| メール | なし | `EmailSender` 抽象＋Resend（無料→必要なら有料）。将来Cloudflare Email Sendingへ差し替え可 | 同左 |
| 濫用対策 | CSPのみ | Turnstile＋D1カウンタ＋WAF 1ルール | 監視・運用スイッチ |
| 定期処理 | なし | Cron Trigger（無料5個まで）：退会データ削除、期限切れOTP/セッション削除 | バックアップ、費用監視 |

**推奨しない選択肢と理由**
- **Cloudflare Pages（新規）**：公式が新規はWorkersを推奨。Cron・Logs・Durable Objects等がWorkers側。
- **サーバー側PDF生成（ブラウザレンダリング等）**：ゲストの個人情報をサーバーへ送る（§6-9に反する）。料金は**未確認**だが採用しない理由はこれで十分。
- **KVでのセッション管理**：書き込み日次上限が小さく、反映遅延があり、即時失効に不向き（§4）。
- **会員ごとのD1・Durable Objectを主データ層にする**：無料はD1が10個まで／DOは履歴検索・エクスポートが複雑。採番だけ必要になった場合の限定利用に留める。
- **Clerk／Auth0／Firebase／Supabase**：会員データが外部に出る・外部依存・二重基盤（§4）。
- **Arctic／Lucia（ライブラリ）／Auth.js**：非推奨・統合済み（§4）。
- **R2を最初から導入**：支払い方法の要否が未確認で、Phase 2初期は不要。
- **React以外のSSRフレームワーク／ORM追加**：静的SPA＋薄いAPIで足りる（過剰構成回避）。

---

## 9. 要件定義書 §6 等への修正・追記案

1. **§6 構成**：「Cloudflare Pages ではなく Workers + Static Assets」と明記（公式推奨）。
2. **§6 認証基盤**：具体化する。「Better Auth（安定版1.7系）＋D1、不合格時は自前最小実装」。**Arctic・Lucia・Auth.js は採用しない（非推奨・統合済み）**。
3. **§6 に「メール送信手段」を追加**：現状記載がない。Cloudflare Email Sendingは**Workers Paid限定のβ**のため、Phase 2開始時は外部サービス（Resend無料等）を想定。**独自の送信ドメイン（SPF/DKIM）が前提**。日100通・月3,000通の上限を明記。
4. **§6-6（連番）**：「D1の `batch()`（トランザクション）＋ユニーク制約＋冪等キー」を採用方式候補として明記。`RETURNING`/日付関数/バッチ上限は未確認でスパイク必須。
5. **§3-12 日次集計**：保存は `issue_date_jst` 列（アプリ側で算出）＋ `daily_usage` で原子的に判定。Cloudflare自身のクォータはUTC基準（JST 9時リセット）で別物と注記。
6. **§3-12 / §7 濫用対策**：会員別100件制限に加え、「新規登録の制限・Turnstile・D1全体の日次書き込み上限（無料10万行/日）超過によるサービス全体停止リスク」を追記。
7. **§3-11 データ保存／バックアップ**：無料のTime Travelは7日、D1は1DB 500MB（無料）、有料でも10GB上限と明記。**バックアップに残る個人情報の保持期間と、復元後の退会者再削除手順**を追記（プライバシーポリシーと連動）。
8. **§7 運営者の閲覧制限**：技術的には運営者はD1全体を閲覧可能。「運用ルール＋管理画面経由の閲覧のみ＋操作履歴」で担保すると明記。
9. **§6-9 ゲストの個人情報**：外部CDN・Google Fonts・アナリティクス・エラー収集サービスの禁止/同意を追記。CSPを要件化。
10. **§6-8 コスト**：無料運営の上限（概算：数百〜1,000人、メール日100通、D1 500MB）と有料移行の境界、**有料化・R2有効化・メール有料プランはコスト発生のため人間承認事項**（§2）と明記。
11. **§3-9/§5 将来の共同管理**：`issuer_members` を後付けできるテーブル設計を指針に追記。
12. **同一メールのOTP/Google統合ルール**（`email_verified` 必須）を §3-1 に追記。

---

## スパイク一覧（Phase 2着手前に実機で確認）

| # | 検証項目 | 合格条件 | 関連 |
|---|---|---|---|
| S1 | 日本語フォントの実サイズ（フル／サブセット）と初回表示、25 MiB制限内か、ブラウザ内サブセット埋め込みPDFの品質 | 1ファイル25 MiB以内、許容時間内 | §1 |
| S2 | D1：`UPDATE … RETURNING`、`changes()`、条件付き `INSERT … SELECT`、`strftime/datetime` のD1での動作、`batch()` の最大文数・100件一括・30秒上限 | 案Aが実装可能か判定（不可なら案B：DO） | §2-2 |
| S3 | **同時発行テスト**：複数タブ／並列100リクエスト／一括100件＋日次100件境界で、欠番・重複・上限超過がゼロか（ユニーク制約・冪等キーのリトライ含む） | 欠番0・重複0・日次101件目が拒否される | §2-2 |
| S4 | 無料プランでの Better Auth＋D1：CPU 10ms／サブリクエスト50に収まるか、OTP試行回数の同時リクエスト耐性、Google＋OTPのアカウント統合、`getMigrations`運用 | Error 1102/サブリクエスト超過なし | §4 |
| S5 | Turnstile：サーバー検証（siteverify）の必須条件、トークン有効期間・単回使用、無料枠の実際の上限／ Rate Limiting バインディングの無料プラン可否・実際の精度 | 公式ページで確認＋実機検証 | §4-(c) |
| S6 | Time Travel復元とエクスポートの手順：会員単位の復元が可能か、退会者の再削除手順、`wrangler d1 export` のブロック時間、Workflowsバックアップ例の実機確認 | 手順書が通る | §5 |
| S7 | 退会削除：カスケード削除の大量データ時の所要時間・分割（1,000行単位）、画像・セッション等の削除漏れがないこと | 退会後に当該 `user_id` の行が0 | §5 |
| S8 | R2：無料アカウントで有効化する際の支払い方法の要否（アカウント操作・課金に関わるため人間の承認後に確認）、画像をD1 BLOBに入れたときの実容量・速度 | 要否が判明 | §3 |
| S9 | メール到達性：Resend（独自ドメイン）の日本のキャリア/Gmail/Outlook宛の到達率、OTP遅延、日100通到達時の挙動／Cloudflare Email Sendingの日次クォータ数値とGA状況の再確認 | OTP到達まで数十秒以内 | §4-(a) |
| S10 | Workers Static Assets：`/api/*` のみ `run_worker_first` にした場合に静的リクエストがWorker課金/429の対象外か、無料プランの帯域に関する記述、`_headers`によるCSP | 静的配信が無料枠を消費しない | §1, §7 |
| S11 | D1の会員分離テスト：他会員のID指定による参照・更新・複合外部キー違反の網羅テスト | 全ケース拒否 | §5 |
| S12 | Brevoなど未取得サービスの料金（必要な場合のみ）／D1のSQLiteバージョンの確認 | 参考情報の補完 | §4 |

---

## 未確認事項のまとめ
- 無料プランの帯域に関する明示記述（有料の段落にのみ記載）
- 日本語フォントの実サイズ
- D1：`RETURNING`、日付関数の動作、`batch()` の最大文数、バッチ中の他リクエスト非割り込みの明記、D1のSQLiteバージョン
- Time Travel の会員単位の復元、Workflowsバックアップ例の内容
- R2有効化の支払い方法の要否
- Cloudflare Email Sendingの日次クォータ数値・GA状況・OTP利用の明示
- Brevoの無料枠（ページ取得不可）、SESの固定無料枠
- Turnstileのsiteverify詳細、Rate Limitingバインディングの無料利用可否・料金
- Better Auth の Cloudflare専用ガイド、無料プランでの実測CPU／@hono/oauth-providers のメンテ状況／Arcticの Google 対応
- Cloudflare側の監査ログ機能
