# Tierlog

Tierlog (ティアログ) は、対応するデジタルカードゲームの対戦記録と環境分析をブラウザ上で扱う Web アプリです。本リポジトリは Tierlog のフロントエンド + Cloudflare Workers ランタイムを含みます。

- 本番: <https://tierlog.app>
- 技術スタック: Next.js (App Router) / React / Supabase / Cloudflare Workers (OpenNext) / TypeScript

開発フロー、ブランチ運用、デプロイ手順、運用ルールは `AGENTS.md` / `CLAUDE.md` (ローカル運用ドキュメント) を参照してください。デザイン基準は `DESIGN.md` を参照してください。

## ローカル開発

```bash
npm install
npm run dev
```

`http://localhost:3000` でアプリが起動します。

`.env.local` に Supabase の URL / anon key 等の環境変数を設定してください (詳細は `CLAUDE.md` 参照)。

## ビルド・デプロイ

本番は Cloudflare Workers の自動ビルド (OpenNext for Cloudflare) で運用しています。`main` への push が本番反映、`dev` への push が preview デプロイです。詳細は `CLAUDE.md` を参照。

## ドキュメント

- `AGENTS.md` / `CLAUDE.md` — 開発・運用ルール (ローカル)
- `DESIGN.md` — UI / ビジュアルデザイン基準
- `docs/app-structure-overview.html` — アプリ構造の概観
- `docs/runbooks/` — 運用ランブック
- `docs/plans/` — 設計プラン履歴
