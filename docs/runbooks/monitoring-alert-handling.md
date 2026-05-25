# runbook: Sentry アラート受信時の一次対応

最終更新: 2026-05-25

## いつ参照する

- Sentry から email 通知を受信した時
- ユーザー報告で「画面が真っ白」「エラーが出る」等があった時、Sentry Dashboard 側でも error が見える時
- 定期的（朝 1 回・夕方 1 回など）に Sentry Dashboard を確認する運用にしている場合

## 最初の 5 分でやること

### 1. Sentry Dashboard で Issue 詳細を確認

1. Sentry → **tierlog-web** project → **Issues**
2. メール通知の Issue ID または「Alert」タブから該当 issue を開く
3. 以下を確認:
   - **Stack trace**: エラー発生箇所のファイル・行（OpenNext + Cloudflare では sourcemap が完全 mapping しない既知制約あり、`handler.mjs` レベル止まり / 詳細は spike report §8 参照）
   - **Event count / User count**: 影響範囲（1 ユーザーか全体か）
   - **First seen / Last seen**: 発生継続中か、収束済か
   - **Environment**: `production` (Worker context から `process.env.NEXT_PUBLIC_SUPABASE_ENV` が `staging` の時に limited で `staging` になる想定だが、初期運用では production project / production DSN のみが正式設定なので基本 production)

### 2. Severity 判定

| Severity | 判定基準 | 次アクション |
|---|---|---|
| **High** | 多数ユーザー (>10 events / 1 hour) に影響、または認証・データ書き込み系の error | 直ちに調査開始、必要なら `cloudflare-rollback.md` で直近 deploy ロールバック |
| **Medium** | 1 桁ユーザー、特定 UI 操作で発生する error | 当日中の調査、ユーザー通知不要のことが多い |
| **Low** | 1〜2 events、無害なエラー（network timeout、AbortError 等） | 週次でまとめて確認、設定で抑制可能なら Inbound Filter で抑制 |

### 3. 影響範囲の確認

```bash
# 本番健全性の確認 (cloudflare-rollback.md §1 と同じ)
curl -sI https://tierlog.app/auth | head -3
curl -s https://tierlog.app/auth | grep -c 'dev-duepure-tracker'
curl -s https://tierlog.app/auth | grep -c 'uqndrkaxmbfjuiociuns'
```

これで HTTP / dev URL 混入 / staging ref 混入を一度に確認。

### 4. 対応の判断

#### A. コード側のバグ修正

1. `dev` branch で修正 → CI green → preview 確認 → main 反映
2. CLAUDE.md の通常ワークフローに従う

#### B. 直前 deploy のロールバック

- High severity で原因が直前 deploy にあると判明した時
- `cloudflare-rollback.md` 参照

#### C. Sentry 側で Issue 抑制

- Low severity で本質的にバグでないもの（network 系等）
- Sentry → Issue → **Resolve** または **Inbound Filters** で抑制
- Inbound Filters で抑制したルールはコメントとして残す

## 誰に通知する

- 運営者（個人開発のため自分自身）
- High severity でユーザー影響大の場合: `incident-communication-template.md` のテンプレートで周知

## Sentry の通知設定（再確認）

- 通知先: 運営者 email のみ（`plan §Resolved Decisions [Sentry 通知先]` → メールのみ）
- 通知ルール: "Alert me on high priority issues" を選択済
- email 通知の頻度は Sentry の Notification Settings で調整可能

## tierlog 特有の Sentry 制約（spike report §9）

| # | 既知制約 | 対処 |
|---:|---|---|
| 1 | Span durations 0ms（Cloudflare 仕様） | Trace 情報は補助、エラー本体に注目 |
| 2 | `waitUntil()` 内の span 喪失 | `Sentry.startSpan({ forceTransaction: true }, ...)` で囲む |
| 3 | sourcemap chain 壊れ（OpenNext issue #19213） | stack trace は handler.mjs レベル止まり |
| 4 | `AsyncLocalStorage` runtime error (issue #18842) | 再発時は instrumentation.ts の `onRequestError` を一時的に外す |
| 5 | Session Replay は client side のみ動作 | Server エラーには replay 不要、現状 `replaysSessionSampleRate: 0` |

## 公式参照

- Sentry Issues: https://docs.sentry.io/product/issues/ （取得日 2026-05-25）
- Sentry Alerts: https://docs.sentry.io/product/alerts/ （取得日 2026-05-25）
- Sentry Inbound Filters: https://docs.sentry.io/concepts/data-management/filtering/ （取得日 2026-05-25）
- Sentry Notifications: https://docs.sentry.io/product/alerts/notifications/ （取得日 2026-05-25）

## 関連 runbook

- `cloudflare-rollback.md` — 直前 deploy のロールバック
- `incident-communication-template.md` — ユーザー周知文
- `supabase-incident-response.md` — Supabase 由来のエラー切り分け

## 関連報告書

- spike: `docs/reports/2026-05-24_sentry_opennext_spike.md` — 既知制約・推奨方針の出典
- incident: `docs/reports/2026-05-25_cloudflare_deploy_incident.md` — Deploy 誤操作との切り分けに参考
