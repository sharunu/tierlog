# Observability Overview

- 作成日: 2026-05-27
- 対象 plan: `docs/plans/2026-05-27_plan_b_observability_og_seo.md` §B-5
- 関連: `docs/runbooks/sentry-runbook.md`, `docs/runbooks/monitoring-alert-handling.md`

本ドキュメントは Tierlog の本番運用において「何をどこで観測するか」を 1 枚に整理した責任分界表。
個別の操作手順は各 runbook を参照する。

---

## 1. 観測層と確認場所

| 観測対象 | 観測層 | 確認場所 | 保持期間 (Free tier 基準) | アクセス権 |
|---|---|---|---|---|
| Cloudflare Workers の例外 (stack trace 付き) | Sentry | Sentry Dashboard | 30 日 | Admin |
| Cloudflare Workers の console.log / console.warn | Cloudflare Logs Engine | Cloudflare Dashboard → Workers & Pages → duepure-tracker → Logs | 7 日 (有償化で延長可) | Admin |
| ページビュー / 国別 / device 別 (匿名統計) | Cloudflare Web Analytics | Cloudflare Dashboard → Web Analytics | 6 ヶ月 | Admin |
| HTTP リクエスト数 / 5xx 率 (worker 単位) | Cloudflare Workers Analytics | Cloudflare Dashboard → Workers & Pages → duepure-tracker → Metrics | 30 日 | Admin |
| Supabase DB の例外・slow query | Supabase Logs | Supabase Dashboard → Logs → Postgres / Edge Logs | 1 日 (有償で延長) | Admin |
| Supabase Auth のログイン履歴 | Supabase Auth Logs | Supabase Dashboard → Auth → Users (各ユーザーの session 履歴) | 7 日 | Admin |
| Supabase Storage の usage / 操作履歴 | Supabase Logs | Supabase Dashboard → Storage / Logs | 1 日 | Admin |
| client (ブラウザ) の console.error | **観測なし** (Plan B スコープ外) | (将来 client Sentry 導入時に拡張) | — | — |
| 不正な共有作成試行 / RLS 違反 | Sentry (Workers 例外として送信) + Supabase Logs | 両者を相互チェック | 上記参照 | Admin |

---

## 2. どんな状況でどこに送るか

| 状況 | 送信先 | 実装ポイント |
|---|---|---|
| HTTP 5xx を返す例外 (route ハンドラ throw) | Sentry | `Sentry.withSentry` (`src/sentry-worker.ts`) が自動捕捉 |
| 認可エラー (RLS / Bearer JWT 不正) | Sentry | API route 内で `throw new Error(...)` か `Sentry.captureException` |
| 業務 warning (cron 不整合 / Discord 連携失敗) | console.warn (Cloudflare Logs Engine) | `console.warn(...)` で十分。Sentry には送らない (issue noise を抑える) |
| Debug トレース | console.log (Cloudflare Logs Engine) | 一時的な観測に限る。本番リリース前に削除を検討 |
| ページビュー / クリック / 国別 | Cloudflare Web Analytics | `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"..."}'>` を root layout に挿入済 |
| DB クエリの実行履歴 | Supabase Logs (自動) | アプリ側の追加コード不要 |
| 公開後に値段単位で観測したい指標 | Cloudflare Workers Analytics Engine | 必要に応じて WAE binding 追加 (現状未配備) |

---

## 3. Sentry の運用ルール (要点)

詳細は `sentry-runbook.md`。要点のみ:

- DSN は Cloudflare Variables and Secrets の **Runtime セクション** に `SENTRY_DSN` として登録 (Build セクションでは Custom Worker entry に届かない)。
- `NEXT_PUBLIC_SUPABASE_ENV=staging` を **Runtime セクションにも登録**することで Sentry `environment` が `staging` と `production` に正しく分離される。
- `release` は Cloudflare Workers Version Metadata Binding (`CF_VERSION_METADATA`) から自動取得 (Plan B B-1)。
- `beforeSend` で Authorization / Cookie / token 系を自動 scrub する設計 (Plan B B-1)。
- `tracesSampleRate: 0.1` (Free tier 枠保護)。
- client / browser 側 Sentry は **未導入** (Plan B スコープ外、Plan E / Phase 2 で検討)。

---

## 4. Cloudflare Web Analytics の運用ルール

- Cookie / 指紋 / 端末識別子を使わない設計 (公式説明)。プライバシー安全。
- `NEXT_PUBLIC_CF_BEACON_TOKEN` を Build セクションに登録済 (`fa4511a0e58e429392eb80c6b9bb184d`、2026-04-26 に Runtime 単独登録から修正)。
- privacy ページで Cloudflare Web Analytics の利用を明記している (現行プライバシーポリシー §4 / §6)。

---

## 5. 「Sentry にイベントが来ない」場合のトラブルシュート

1. Cloudflare ダッシュボード → Workers & Pages → duepure-tracker → Settings → **Variables and Secrets (Runtime)** に `SENTRY_DSN` が登録されているか確認。
2. Sentry Dashboard → Project Settings → Client Keys (DSN) で DSN が現在も active か確認。
3. Sentry Dashboard → Stats → Rate Limit / Quota で free tier 上限に達していないか確認。
4. dev preview と本番で同 DSN を使っているか、`environment` の差で分離されているか (Environment フィルタを切り替え)。
5. `release` 値が `unknown` 固定になっていたら `wrangler.jsonc` の `version_metadata.binding = "CF_VERSION_METADATA"` が抜けていないか確認。
6. 上記すべて OK でも届かない場合、`src/sentry-worker.ts` の `beforeSend` 内で例外が起きて event を捨てている可能性 → console.warn(`Sentry beforeSend scrub failed:`) ログが Cloudflare Logs Engine に出ているか確認。

---

## 6. 「Console log が見えない」場合のトラブルシュート

1. Cloudflare Dashboard → Workers & Pages → duepure-tracker → Logs で realtime stream が有効か確認。
2. `wrangler.jsonc` の `observability.enabled = true` が抜けていないか確認 (Plan B 時点で有効)。
3. ログ保持期間 (Free 7 日) を超過していないか確認。長期保存が必要なら Logpush で R2 / S3 に転送。

---

## 7. 関連 runbook

- `docs/runbooks/sentry-runbook.md` — Sentry の DSN 設定 / scrubber 設計 / release 連携 / トラブルシュート
- `docs/runbooks/monitoring-alert-handling.md` — Cloudflare / Supabase alert への一次対応
- `docs/runbooks/cloudflare-rollback.md` — 本番 deploy 障害時の rollback
- `docs/runbooks/supabase-incident-response.md` — Supabase 障害時対応
- `docs/runbooks/database-backup-restore.md` — DB バックアップ / リストア
- `docs/runbooks/incident-communication-template.md` — インシデント通知文の雛形
