# 領収書作成Webアプリ（receipt-app）

誰でも、簡単に、きれいな領収書を作れる無料のWebアプリ。**会員登録不要。入力内容はサーバーへ送らず、ブラウザー内でPDFを作ります。**

- 状態：**Phase 1（ゲスト版）の実装中。本人による動作検証の段階**（公開前）。Phase 2（会員機能）・Phase 3（正式公開）は未着手。
- 要件：`docs/requirements-v3.3.md` ＋ `docs/requirements-v3.4-delta.md`（差分が優先）
- 設計・分担：`docs/ARCHITECTURE.md`／レビュー結果：`docs/review/`（統合：`00-summary-review.md`）

## 使い方（開発）

```bash
npm install
npm run dev        # 開発サーバー
npm test           # 単体・結合テスト（vitest）
npm run typecheck  # 型検査
npm run build      # 型検査＋ビルド（dist/）
```

- 日本語フォントの再生成：`python scripts/build-fonts.py`（要 fonttools・brotli。出力は `public/fonts/`）。
- デプロイ構成：Cloudflare Workers + Static Assets（`wrangler.jsonc`）。**デプロイは人間の承認後に行う**（このリポジトリのツールは実行しない）。

## ディレクトリ

| パス | 内容 |
|---|---|
| `src/domain/` | 税計算・モード別検証・印紙税の目安・登録番号（純粋関数） |
| `src/layout/` | 描画リスト、3デザイン、4印刷形式の面付け、SVGプレビュー、試し刷りページ |
| `src/pdf/` | PDF生成（pdfkit、Web Worker） |
| `src/seal/` `src/image/` | 角印の作成、画像のアップロード処理 |
| `src/bulk/` | CSV・貼り付けによる一括発行の取り込み |
| `src/ui/` `src/storage/` | 画面、ブラウザー内の下書き保存（IndexedDB） |
| `public/fonts/` | 日本語フォント（Noto Sans/Serif JP のサブセット、OFL） |

## 注意

- 税務・法務の判断は公式資料（国税庁等）に基づくが、**AIによる確認であり、法的適合性を保証しない**。公開前に税理士・弁護士の確認が必要（`docs/review/worker-B-tax-legal.md` の質問リスト）。
- 印紙税・消費税の表示は**目安**。
- ライセンス：`THIRD_PARTY_NOTICES.md`（フォントはSIL OFL 1.1）。
