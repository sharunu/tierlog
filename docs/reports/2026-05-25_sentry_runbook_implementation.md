# 実装報告書: エラートラッキング + 障害対応 runbook（#6）

- 報告日: 2026-05-25
- 対象 plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-4 #6-a / #6-b
- 対象レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` §4-4 公開ブロッカー #6
- ステータス: **dev 完了、本番反映待ち**（SENTRY_DSN Runtime variable のユーザー側再確認後に main 反映）
- 関連 incident 報告書: `docs/reports/2026-05-25_cloudflare_deploy_incident.md`

---

## 1. サマリ

`#6` 「エラートラッキング・通知・障害対応 runbook」の実装を完了。Sentry の Cloudflare Workers + OpenNext 統合は当初 `@sentry/nextjs` の `instrumentation.ts` 経路で着手したが OpenNext の `copyTracedFiles` と互換性問題で build 失敗、`@sentry/cloudflare` の Custom Worker パターンに切り替えて成功。ローカル wrangler preview で Sentry SDK の疎通を確認済（issue が Sentry Dashboard に到達）。

本実装途中で Cloudflare Dashboard の **Deploy** ボタン誤押下によって dev branch のビルドが本番に展開される incident が発生したが、Cloudflare の deployment rollback 機能で即座に復旧、CLAUDE.md 既存ルール（Deploy ボタンを押さない）を再徹底し、本番健全性確認の手順を runbook 化することで再発防止策を実装した。

`docs/runbooks/` 配下に 5 件の runbook（cloudflare-rollback / supabase-incident-response / database-backup-restore / monitoring-alert-handling / incident-communication-template）を新規追加し、plan §4-4 #6 の完了条件をすべて満たす状態とした。

---

## 2. 経緯（時系列）

### 2.1 #6-a spike（前日 2026-05-24）

`docs/reports/2026-05-24_sentry_opennext_spike.md` で実施。結論:
- `@sentry/nextjs >= 10.28.0` を単独採用（Sentry 公式 Cloudflare + Next.js guide 推奨）
- compatibility_date を `2025-08-16` 以降に更新必須
- DSN は Build variable `NEXT_PUBLIC_SENTRY_DSN`
- 初期は sourcemap upload 無効、client/replays 無効

### 2.2 Phase 1: compatibility_date 更新（commit `686e5de`）

`wrangler.jsonc` の `compatibility_date: 2025-05-05` → `2025-08-16` に更新。
理由: Sentry SDK が要求する `https.request` API のため（Sentry 公式 docs より）。

### 2.3 Phase 2: @sentry/nextjs SDK 試行（commit `3375103`）

- `@sentry/nextjs@10.53.1` install
- `instrumentation.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` / `instrumentation-client.ts` 新規作成
- `next.config.ts` を `withSentryConfig` でラップ + `outputFileTracingIncludes` workaround
- ローカル `opennextjs-cloudflare build` で `File server/instrumentation.js does not exist` エラー

調査結果:
- vercel/next.js#68740（open）: Instrumentation files not included in standalone output
- OpenNext for Cloudflare の `copyTracedFiles` が Next.js 16 の turbopack build 出力で `.next/standalone/.next/server/instrumentation.js` を要求するが、Next.js が standalone copy していない
- `output: "standalone"` の有無、`turbopack: {}` の有無、OpenNext 1.19.8 → 1.19.11 upgrade、いずれでも解消せず

### 2.4 Phase 2.5: eslint cleanup（commit `0aca978`）

`@sentry/nextjs` install 後の `npm install` 副作用で `eslint-plugin-react-hooks@7.0.1` の挙動変化を確認。`react-hooks/set-state-in-effect` ルールが緩和され、`#3` で追加した 25 件の `eslint-disable` が冗長判定された。`eslint --fix` で自動削除 + `sed` で trailing whitespace 除去。

### 2.5 Revert Phase 2（commit `2f7eb42`）

ユーザー指示「ローカル opennextjs-cloudflare build が通る状態に戻す」に従い、Phase 2 のみ revert。Phase 1（compatibility_date）と Phase 2.5（eslint cleanup）は保持。ローカル build 成功確認。

### 2.6 Phase 3: @sentry/cloudflare Custom Worker パターン採用（commit `a6e7952`）

spike report §5.2 / §13-B の fallback パターンへ切り替え:
- `@sentry/cloudflare@10.53.1` install
- `src/sentry-worker.ts` 新規作成（`Sentry.withSentry` で `.open-next/worker.js` の handler を wrap）
- `wrangler.jsonc` の `main` を `.open-next/worker.js` → `src/sentry-worker.ts` に変更（OpenNext 公式 [custom-worker docs](https://opennext.js.org/cloudflare/howtos/custom-worker) の唯一の推奨手順）
- `tsconfig.json` の `exclude` に `.open-next` 追加
- `instrumentation.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` / `instrumentation-client.ts` は削除
- ローカル `opennextjs-cloudflare build` 成功確認

設計判断:
- `@sentry/cloudflare` の peerDependency `@cloudflare/workers-types` は install しない（既存コードの `CloudflareEnv` 型 cast を壊すため）
- `ExportedHandler` 型は使わず `Sentry.withSentry` の型推論に任せる
- 初期は browser/client 側 Sentry は導入しない（ユーザー指示「client 側に @sentry/cloudflare は使わない、初期保留」）

### 2.7 Phase 4: 動作検証（commits `3c6271e` / `78ba41e` / `8c190f8` / `fe0ab55`）

管理者専用 endpoint `src/app/api/internal/sentry-test/route.ts` を一時追加し、`INTERNAL_API_KEY` 保護下で `throw` → 動作確認 → 削除する設計。

検証経過:
1. `3c6271e`: 単純 throw → dev preview で HTTP 500 確認、Sentry Dashboard に届かず
2. `78ba41e`: `Sentry.captureException` + `Sentry.flush` 明示呼び出しに切替 → HTTP 500 確認、Sentry に届かず
3. `8c190f8`: throw を一旦やめて Sentry SDK 状態を JSON で返す診断モードに変更
4. dev preview で診断 endpoint を叩いた結果、`has_sentry_dsn_env: false` を確認。**SENTRY_DSN が dev preview ランタイムに届いていなかった**ことが原因と判明
5. `fe0ab55`: empty commit で dev preview の再ビルドを trigger

### 2.8 Cloudflare Deploy 誤操作 incident（2026-05-25 JST）

Phase 4 検証中に発生した重大 incident。**詳細は `docs/reports/2026-05-25_cloudflare_deploy_incident.md` を参照**。

**経緯**:
- ユーザーが Cloudflare Dashboard で `SENTRY_DSN` Runtime variable を追加した際、誤って **Deploy** ボタン押下
- Cloudflare Workers Builds の Deploy ボタンは「現在の最新ビルド」を本番に展開する設計
- その時点の「最新ビルド」は dev branch の最新コミット（Phase 3 系）由来のビルド
- dev branch のビルドは `prepare-cloudflare-env.sh` で `STAGING_NEXT_PUBLIC_*` → `NEXT_PUBLIC_*` に写すため staging Supabase を参照
- 結果: tierlog.app/auth の配信 JS に staging Supabase project ref `uqndrkaxmbfjuiociuns` と dev preview URL `dev-duepure-tracker.jianrenzhongtian7.workers.dev` が混入

**復旧**:
- ユーザーが Cloudflare deployment rollback で `b475291f`（Merge branch 'dev' / main の過去 deployment）に戻す
- Codex 側で復旧確認:
  - `curl -sI https://tierlog.app/` → **HTTP 200**
  - `curl -sI https://tierlog.app/auth` → **HTTP 200**
  - `curl -s https://tierlog.app/auth | grep -c 'dev-duepure-tracker'` → **0**
  - `curl -s https://tierlog.app/auth | grep -c 'uqndrkaxmbfjuiociuns'` → **0**

**CLAUDE.md 既存ルール（再徹底）**:
> Variables and Secrets画面で環境変数を保存する際、「Save」と「Deploy」の2つのボタンがある：
> - Save: 変数を保存するだけ。次のビルド時から反映。通常はこれを使う。
> - Deploy: 変数保存に加え、現在の最新ビルドを即座に本番デプロイする。これを押すと、プレビュー環境のビルド（dev ブランチ由来）を本番として展開してしまい、git main と本番が不一致になる事故が起きる。

→ **以降、Dashboard の Deploy ボタンは絶対に押さない**。変数反映が必要な場合は `git commit --allow-empty && git push` で再ビルド trigger。

### 2.9 Phase 4 完了: ローカル wrangler preview で疎通成功（commit `b0de64b` で endpoint 削除）

ユーザー指示で Cloudflare dev preview 検証を中断、ローカル `npm run preview` での検証に切替（plan §Resolved Decisions [Sentry env 分離] と整合、dev に Runtime variable を追加する運用を回避）。

**ユーザー側で実施した検証**:
- `.dev.vars`（`.gitignore` 済）に `SENTRY_DSN` と `INTERNAL_API_KEY` を設定
- `npm run preview` でローカル wrangler preview 起動
- `set -a; source .dev.vars; set +a` 経由で `curl -s -H "X-Internal-Key: $INTERNAL_API_KEY" http://localhost:8787/api/internal/sentry-test`

**結果 JSON**:
```json
{
  "timestamp": "2026-05-25T11:59:29.303Z",
  "runtime": "node-compat",
  "has_sentry_dsn_env": true,
  "sentry_dsn_prefix": "https://df47...(masked)",
  "has_sentry_client": true,
  "sentry_client_dsn_host": "o4511448281513984.ingest.us.sentry.io",
  "captured_event_id": "31a22bd45a874cd686273a96625a26c0",
  "flush_result": true
}
```

Sentry Dashboard に **"Sentry diagnostic test 2026-05-25 (no throw, JSON return)"** が表示。Sentry SDK の疎通が完全に動作することを確認。

検証完了後、`b0de64b` で `src/app/api/internal/sentry-test/route.ts` を削除。**最終 main state には残らない**（dev の git 履歴には残る）。

### 2.10 Phase 5: runbook 5 件追加（commit `a8dda63`）

`docs/runbooks/` 配下に新規作成（既存 `staging-data-sync.md` 含めて計 6 件）:

1. **cloudflare-rollback.md**:
   - 本日 incident を反映した本番健全性確認 curl コマンド（HTTP 200 + dev URL 混入 + staging ref 混入の 3 チェック）
   - Cloudflare deployment rollback の操作手順
   - 「Deploy ボタンを絶対押さない」CLAUDE.md ルール再徹底

2. **supabase-incident-response.md**:
   - Supabase 公式 Status / Dashboard 確認手順
   - tierlog の Supabase 構成（production / staging）の整理

3. **database-backup-restore.md**:
   - Free Plan / Pro Plan のバックアップ可用性差を明示
   - PITR / pg_dump / ロールフォワード 3 経路

4. **monitoring-alert-handling.md**:
   - Sentry アラート受信時の severity 判定と対応
   - tierlog 特有の Sentry 制約（spike report §9）を含む

5. **incident-communication-template.md**:
   - ユーザー周知文テンプレート（障害発生 / 復旧 / 計画メンテ / データ事故告知）
   - 個人情報保護委員会の漏えい等報告ガイドライン参照

各 runbook は plan §4-4 完了条件「いつ参照する」「最初の 5 分でやること」「誰に通知する」+ 公式 docs 参照 URL（取得日 2026-05-25 付き）を含む。

---

## 3. 検証 endpoint の取り扱い（main 最終 state 確認）

- 検証 endpoint `src/app/api/internal/sentry-test/route.ts` は dev branch の commit `3c6271e` で追加、`b0de64b` で削除
- dev の git 履歴上は試行錯誤の commits が残る（透明性のため通常 merge で main に反映する方針）
- **main の最終 file state には endpoint は存在しない**（削除済 commit が反映されるため）
- 本番 tierlog.app に test endpoint が露出することは構造的にない

---

## 4. 本番反映後の確認項目

main 反映完了後、Cloudflare 自動ビルド（3〜5 分）が完了したら以下を実施:

### 4-1. 本番健全性確認（cloudflare-rollback.md §1 と同じ）

```bash
curl -sI https://tierlog.app/auth | head -3
# → HTTP 200

curl -s https://tierlog.app/auth | grep -c 'dev-duepure-tracker'
# → 0

curl -s https://tierlog.app/auth | grep -c 'uqndrkaxmbfjuiociuns'
# → 0
```

### 4-2. main コード由来の確認（Sentry 統合）

Phase 3 の `next.config.ts` は CSP `connect-src` に `*.ingest.sentry.io` を追加していない（client 側 Sentry 未導入のため）。よって CSP では Sentry 統合の有無は判定不可。

代わりに以下で判定:

```bash
# Cloudflare Dashboard → Workers & Pages → duepure-tracker → Deployments で
# Active deployment の commit SHA が main tip と一致することを確認
```

### 4-3. Sentry 本番動作の確認（任意）

本番でテスト throw は安全条件が必要なため、初期は実施しない。実運用エラーで Sentry に届くことを観察する。長期間 events が 0 件の場合は SDK 構成を再確認。

---

## 5. 残作業

| # | 項目 | 状態 |
|---:|---|---|
| 1 | Cloudflare Dashboard で `SENTRY_DSN` Runtime variable の存在確認、未存在なら追加（**Save のみ**、Deploy 押下禁止） | **ユーザー側で実施** |
| 2 | main 反映（通常 merge `--no-ff`） | Claude 作業（ユーザー指示後） |
| 3 | main 反映後の本番健全性確認（§4-1） | ユーザー側で実施 |
| 4 | Cloudflare Email Routing 設定（`contact@tierlog.app`、`#1+#2` 残作業） | ユーザー側で別途 |
| 5 | 公開ブロッカー #4（最小ユニットテスト追加） | 次フェーズ |

---

## 6. CLAUDE.md / plan への補強候補

本 incident と Sentry 実装経験から、CLAUDE.md / plan に追記すべき項目:

- ✅ Cloudflare Dashboard の Deploy ボタン禁止ルール（既に CLAUDE.md に記載済）
- ⏳ 本番健全性確認の curl コマンド 3 件を CLAUDE.md または `cloudflare-rollback.md` に標準化（本 commit で runbook 化済）
- ⏳ OpenNext + Next.js 16 + Sentry の Custom Worker パターン（@sentry/nextjs ではなく @sentry/cloudflare）を CLAUDE.md の技術スタック節に追記する候補（任意）

これらは main 反映後の cleanup フェーズで判断する。

---

## 7. 関連 commit / 報告書

### dev branch の #6 関連 commits（12 件）

| commit | 内容 |
|---|---|
| `686e5de` | Phase 1: compatibility_date 2025-08-16 更新 |
| `3375103` | Phase 2: @sentry/nextjs SDK install（**revert された**） |
| `0aca978` | Phase 2.5: eslint cleanup |
| `2f7eb42` | Revert Phase 2 |
| `a6e7952` | Phase 3: @sentry/cloudflare Custom Worker 採用 |
| `3c6271e` | Phase 4: 検証 endpoint 追加 |
| `78ba41e` | Phase 4: captureException + flush 切替 |
| `8c190f8` | Phase 4: 診断 JSON モードに切替 |
| `fe0ab55` | empty commit（再ビルド trigger 試行） |
| `fbde446` | incident report 追加 |
| `b0de64b` | Phase 4: 検証 endpoint 削除（完了） |
| `a8dda63` | Phase 5: runbook 5 件追加 |

### 関連報告書

- spike: `docs/reports/2026-05-24_sentry_opennext_spike.md`
- incident: `docs/reports/2026-05-25_cloudflare_deploy_incident.md`
- 元レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` §4-4

### 関連 runbook

- `docs/runbooks/cloudflare-rollback.md`（本日 incident を反映）
- `docs/runbooks/supabase-incident-response.md`
- `docs/runbooks/database-backup-restore.md`
- `docs/runbooks/monitoring-alert-handling.md`
- `docs/runbooks/incident-communication-template.md`

### plan

- `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-4 #6 / §Resolved Decisions
