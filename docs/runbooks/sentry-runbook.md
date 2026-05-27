# Sentry Runbook

- 作成日: 2026-05-27
- 対象実装: `src/sentry-worker.ts` (Plan B B-1 反映後)
- 関連 plan: `docs/plans/2026-05-27_plan_b_observability_og_seo.md` §B-1
- 関連実装報告 (旧): `docs/reports/2026-05-25_sentry_runbook_implementation.md`
- 関連 runbook: `docs/runbooks/observability-overview.md`

本 runbook は Tierlog の Sentry 設定 (Cloudflare Workers + Custom Worker entry) を一次正としてまとめたもの。

---

## 1. アーキテクチャ概要

```
Cloudflare Workers runtime
  └─ src/sentry-worker.ts (Custom Worker entry)
        ├─ Sentry.withSentry({ ... }) でラップ
        │     ├─ dsn:         env.SENTRY_DSN (Runtime secret)
        │     ├─ environment: env.NEXT_PUBLIC_SUPABASE_ENV ('staging' | 'production')
        │     ├─ release:     env.CF_VERSION_METADATA?.id (Cloudflare Workers Version Metadata Binding)
        │     ├─ sendDefaultPii: false
        │     ├─ tracesSampleRate: 0.1
        │     └─ beforeSend: 機微情報 (Authorization / Cookie / token / Supabase key) を [Filtered] に置換
        │
        └─ handler.fetch (OpenNext for Cloudflare bundle: .open-next/worker.js)
```

- **client / browser 側 Sentry は未導入**。Plan B B-5 / Plan E (Phase 2) で検討。
- **`@sentry/nextjs` の instrumentation.ts 経路は採用しない**。OpenNext との互換性問題 (vercel/next.js#68740) のため Custom Worker pattern を採用。

---

## 2. Cloudflare ダッシュボード設定

### 2.1 Variables and Secrets (Runtime) に登録するもの

| 名前 | 値 | 用途 |
|---|---|---|
| `SENTRY_DSN` | Sentry プロジェクト固有の DSN | Sentry SDK が event 送信先として参照 |
| `NEXT_PUBLIC_SUPABASE_ENV` | `staging` (dev preview のみ) / 未設定 (本番) | `environment` 判定。staging を Runtime にも登録しないと Sentry が production と誤判定する |

### 2.2 Build variables and secrets

`SENTRY_DSN` は Build セクションには登録しない (Custom Worker entry には届かないため不要、ただし重複登録しても害はない)。
`NEXT_PUBLIC_SUPABASE_ENV` は Build セクション側でも `scripts/prepare-cloudflare-env.sh` が dev branch ビルド時に staging 値を設定するので、すでに整合している。

### 2.3 Version Metadata Binding

`wrangler.jsonc` で以下を設定済 (Plan B B-1 で追加):

```jsonc
"version_metadata": {
  "binding": "CF_VERSION_METADATA"
}
```

これにより worker runtime で `env.CF_VERSION_METADATA = { id, tag, timestamp }` がアクセス可能。`id` を Sentry `release` として使用。

参考: <https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/>

---

## 3. beforeSend Scrubber の動作

`src/sentry-worker.ts` の `buildBeforeSend()` が以下を自動 scrub する。

### Headers (request.headers / breadcrumb の request_headers / response_headers)

以下の正規表現に一致する header は `[Filtered]` に置換 (case-insensitive):

```
^(authorization|cookie|set-cookie|x-internal-key|x-supabase-.*|apikey)$
```

### URL Query (request.url / breadcrumb の url)

以下の query parameter は **値だけ** `[Filtered]` に置換 (key=value 形式は維持):

- `access_token`
- `refresh_token`
- `id_token`
- `provider_token`
- `provider_refresh_token`
- `code` (OAuth 認可コード)
- `state` (CSRF state)
- `apikey`

### Request Body (request.data)

- string body は丸ごと `[Filtered]` (中身が JSON か form か不明なため安全側に倒す)
- object body は **再帰的に walk** して、以下 key にマッチするフィールドの値を `[Filtered]` に:
  - `password`, `access_token`, `refresh_token`, `id_token`, `provider_token`, `provider_refresh_token`, `apikey`, `authorization`, `cookie`
- 16 KB 超は body 全体を `[Filtered]` (`MAX_BODY_BYTES`)
- 再帰深度 8 超は `[Filtered]` (循環参照 / 巨大ネスト保護)

### user 情報

`sendDefaultPii: false` の二重防御として、`event.user.email` / `event.user.username` / `event.user.ip_address` を明示削除。

### scrub 例外時のフォールバック

`buildBeforeSend()` の本体は `try { ... } catch { console.warn(...) }`。scrub 中に例外が起きても event 自体は捨てず Sentry に届ける (元の event をそのまま返す)。

---

## 4. 動作確認手順

### 4.1 dev preview で test event を送る

```bash
# Sentry ダッシュボードの Test Event 機能を使うか、staging に存在しない share を叩いて 404 を出す
curl -sI "https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/api/og/test-nonexistent-id"

# 404 自体は通常エラー。Sentry に届ける場合は API route を一時的に throw する patch を当てて検証。
```

### 4.2 Sentry Dashboard で確認するチェックリスト

| 項目 | 確認場所 | 期待値 |
|---|---|---|
| event の `Environment` | Issue 詳細 / Environment フィルタ | `staging` (dev preview) / `production` (tierlog.app) |
| event の `Release` | Issue 詳細 / Release | Cloudflare deploy id (短い hex 文字列) |
| event の `request.headers.authorization` | Issue payload | `[Filtered]` |
| event の `request.url` (token 付き) | Issue payload | token value が `[Filtered]` |
| event の `request.data.password` | Issue payload | `[Filtered]` |
| event の `user.email` | Issue payload | 存在しない / `undefined` |

### 4.3 Cloudflare Workers Version 連携

Sentry ダッシュボードの Release タブで release id が複数並んでいれば、Cloudflare deploy ごとに正しく分離されている。Release が `unknown` 一つしかない場合は `wrangler.jsonc` の `version_metadata` 設定漏れ。

---

## 5. トラブルシュート

### 5.1 「Sentry にイベントが来ない」

1. **DSN が Runtime セクションにあるか確認**: Cloudflare Dashboard → Workers & Pages → duepure-tracker → Settings → Variables and Secrets。**Build セクションに登録していても Custom Worker entry には届かない**。
2. Sentry プロジェクトの Rate Limit に達していないか確認。
3. `tracesSampleRate: 0.1` で性能トランザクションが間引かれている可能性 (現状は意図通り)。エラー event は sampling されないため別。
4. Cloudflare Logs Engine で `console.warn("Sentry beforeSend scrub failed:")` を grep。scrub 失敗時のヒント。

### 5.2 「環境が production / staging で分離されない」

1. Cloudflare Runtime セクションに `NEXT_PUBLIC_SUPABASE_ENV=staging` を登録しているか確認。
2. `Sentry.withSentry` の config を返す関数で `env.NEXT_PUBLIC_SUPABASE_ENV` を見ているか確認 (Plan B B-1 で確定の実装)。

### 5.3 「Release が `unknown` 固定」

1. `wrangler.jsonc` に `version_metadata: { binding: "CF_VERSION_METADATA" }` があるか確認。
2. Cloudflare Workers の deploy version が **新しい binding 付きで一度デプロイされている** か確認。binding 追加直後の旧 deploy は `CF_VERSION_METADATA` が undefined のまま。

### 5.4 「機微情報が Sentry に漏れた疑い」

1. Sentry Issue の payload を確認し、漏れた項目を特定。
2. `src/sentry-worker.ts` の `SENSITIVE_HEADER_PATTERN` / `SENSITIVE_QUERY_PARAMS` / `SENSITIVE_BODY_KEYS` にその項目を追加。
3. PR を作成し dev → 本番反映。Plan B 完了後は本ファイルがメンテナンス対象。

---

## 6. 関連リンク

- Plan B: `docs/plans/2026-05-27_plan_b_observability_og_seo.md` §B-1
- 旧実装報告: `docs/reports/2026-05-25_sentry_runbook_implementation.md`
- Sentry Cloudflare SDK docs: <https://docs.sentry.io/platforms/javascript/guides/cloudflare/>
- Cloudflare Version Metadata Binding: <https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/>
- OpenNext Custom Worker pattern: <https://opennext.js.org/cloudflare/howtos/custom-worker>
- Observability overview: `docs/runbooks/observability-overview.md`
