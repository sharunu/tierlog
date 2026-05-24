# spike レポート: Sentry × OpenNext for Cloudflare 適合性調査（#6-a）

- 報告日: 2026-05-24
- 対象 plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-4 #6-a
- ステータス: **spike 完了、実装方針案を提示（ユーザー判断待ち）**
- 範囲: Sentry SDK 構成の確定、OpenNext 生成物との適合性、wrangler 設定変更要否、DSN/sourcemap の扱い、Sentry 不可時の代替候補

---

## 1. 結論サマリ

`@sentry/nextjs >= 10.28.0` を単独採用し、`.open-next/worker.js` の wrap は行わず Next.js 標準の `instrumentation.ts` 経路で動かす方針が、Sentry 公式 "Cloudflare + Next.js" guide の現行推奨。`@sentry/cloudflare` 併用は公式手順に存在せず、`init` を export していない設計上の制約もあるため不採用。`wrangler.jsonc` の `compatibility_date` を **2025-05-05 → 2025-08-16 以降へ更新が必須**（Sentry SDK が必要とする `https.request` API のため）。本リポジトリの現状（OpenNext 1.19.8 / next 16.2.6 / `.open-next/worker.js` は ESM default fetch handler）は公式 guide の前提と整合する。一方で sourcemap の元ソース解決が OpenNext 側で壊れている既知問題（issue #19213）と、`AsyncLocalStorage` 関連の runtime error（issue #18842）があり、本実装着手時の検証で再現するかを必ず確認する。Logflare 等の代替は Sentry が動作不能と判明した場合のフォールバックとして位置付け、本 spike では参考程度。

---

## 2. 調査方法

1. Sentry / OpenNext / Cloudflare の各公式 docs を WebFetch で精読（全 URL に取得日 2026-05-24 を付与）
2. GitHub issue tracker（getsentry/sentry-javascript、opennextjs/opennextjs-cloudflare）で「OpenNext × Cloudflare × Sentry」関連 issue の現況を確認
3. ローカルの実コードベースを Read で確認:
   - `wrangler.jsonc` / `open-next.config.ts` / `next.config.ts` / `package.json` / `.open-next/worker.js`
4. テスト throw / spike 用一時コードは本リポジトリに**一切置かない**方針（plan §4-4 #6-b の安全条件、ユーザー指示）— 検証は本実装フェーズ (#6-b) の管理者専用 endpoint で行う

---

## 3. 公式 docs 参照（取得日: 2026-05-24）

### Sentry 公式

| URL | 内容 | アクセス可否 |
|---|---|---|
| https://docs.sentry.io/platforms/javascript/guides/cloudflare/ | Cloudflare Workers 向け SDK guide。`@sentry/cloudflare` の `withSentry` 手順、sourcemap 設定 | ✅ |
| https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nextjs/ | **Next.js on Cloudflare guide（2025-11〜12 追加）**。compatibility_date 2025-08-16+ 必須を明示。本 spike の核心 | ✅ |
| https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/options/ | Sentry.init options | ✅ |
| https://docs.sentry.io/platforms/javascript/guides/nextjs/ | Next.js SDK 一般 guide（Vercel / Node.js / Edge 想定） | ✅ |
| https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/ | instrumentation.ts / sentry.server.config.ts 等の手動セットアップ手順 | ✅ |
| https://docs.sentry.io/platforms/javascript/guides/cloudflare/install/ | install 手順専用ページ | ❌ 404 |
| https://docs.sentry.io/platforms/javascript/guides/cloudflare/sourcemaps/uploading/wrangler/ | sourcemap wrangler 手順専用ページ | ❌ 404（内容は cloudflare/ ページに統合） |
| https://github.com/getsentry/sentry-javascript/issues/14931 | OpenNext + Cloudflare + Sentry の経緯（closed 2025-12-02） | ✅ |
| https://github.com/getsentry/sentry-javascript/issues/18842 | AsyncLocalStorage runtime error（open、v10.33.0 でも再発報告） | ✅ |
| https://github.com/getsentry/sentry-javascript/issues/18843 | OpenNext build 時の `Could not resolve "@sentry/nextjs"` workaround | ✅ |
| https://github.com/getsentry/sentry-javascript/issues/19213 | sourcemap chain 壊れ問題（open、最終 2026-02） | ✅ |
| https://sentry.io/pricing/ | Developer Free tier（errors 5k/月、spans 5M/月、replays 50/月） | ✅ |

### OpenNext / Cloudflare 公式

| URL | 内容 | アクセス可否 |
|---|---|---|
| https://opennext.js.org/cloudflare | OpenNext for Cloudflare 全体 | ✅（Sentry / monitoring の言及なし） |
| https://opennext.js.org/cloudflare/howtos/custom-worker | Custom worker wrap パターン（フォールバック用） | ✅ |
| https://opennext.js.org/cloudflare/monitoring | monitoring 専用ページ | ❌ 404（未作成） |
| https://opennext.js.org/cloudflare/howtos | howtos 一覧 | ❌ 404（旧 URL） |
| https://developers.cloudflare.com/workers/configuration/compatibility-flags/ | `nodejs_compat` 等の挙動 | ✅ |
| https://github.com/opennextjs/opennextjs-cloudflare/issues/1124 | OpenNext 側の sourcemap 対応 issue（open、対応待ち） | ✅ |

> OpenNext 公式 docs には **Sentry に関する記述が一切存在しない**。実装方針は Sentry 側 docs と GitHub issue の二次情報に依存する。

---

## 4. ローカル現状（実コードベース確認）

### 4.1 `wrangler.jsonc`

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "duepure-tracker",
  "main": ".open-next/worker.js",
  "compatibility_date": "2025-05-05",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "observability": { "enabled": true },
  "ratelimits": [
    { "name": "NEXTJS_DOS_LIMITER", "namespace_id": "1001",
      "simple": { "limit": 60, "period": 60 } }
  ]
}
```

- `compatibility_date: 2025-05-05` ← **更新必須**
- `nodejs_compat` 既に有効 ✓
- `observability.enabled: true` ✓（Cloudflare 側のログ収集は既に有効、Sentry とは別系統）

### 4.2 `open-next.config.ts`

```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
export default defineCloudflareConfig({});
```

最小構成。Sentry 用の追加設定は不要（OpenNext 側で hook する仕組みは無いため）。

### 4.3 `package.json`（抜粋）

- `"next": "16.2.6"`
- `"@opennextjs/cloudflare": "^1.19.8"`
- `"build": ". ./scripts/prepare-cloudflare-env.sh && next build"`
- `"preview": ". ./scripts/prepare-cloudflare-env.sh && opennextjs-cloudflare build && opennextjs-cloudflare preview"`
- `"deploy": ". ./scripts/prepare-cloudflare-env.sh && opennextjs-cloudflare build && opennextjs-cloudflare deploy"`

### 4.4 `.open-next/worker.js`（2026-05-19 生成、ESM）

```js
import { handleCdnCgiImageRequest, handleImageRequest } from "./cloudflare/images.js";
import { runWithCloudflareRequestContext } from "./cloudflare/init.js";
import { maybeGetSkewProtectionResponse } from "./cloudflare/skew-protection.js";
import { handler as middlewareHandler } from "./middleware/handler.mjs";

export { DOQueueHandler } from "./.build/durable-objects/queue.js";
export { DOShardedTagCache } from "./.build/durable-objects/sharded-tag-cache.js";
export { BucketCachePurge } from "./.build/durable-objects/bucket-cache-purge.js";

export default {
    async fetch(request, env, ctx) {
        return runWithCloudflareRequestContext(request, env, ctx, async () => {
            // skew protection / CDN images / Next image / middleware / server handler
        });
    },
};
```

**判定**:
- ✅ **ESM default fetch handler 形式**（`Sentry.withSentry()` の前提を満たす）
- ✅ Durable Objects も named export されており、wrap 時は再 export 必要
- ⚠️ ファイルは OpenNext build 時に自動生成される — 直接編集すると次回 build で消える

→ もし `withSentry` で wrap するなら、別ファイル `src/sentry-worker.ts` 等を作成し、`wrangler.jsonc` の `main` をそちらに向ける必要がある（plan §4-4 案 2）。ただし後述の通り、`@sentry/nextjs` 単独で完結する方針なら `.open-next/worker.js` への wrap 自体が不要。

---

## 5. SDK 構成の判定

### 5.1 `@sentry/nextjs` 単独（推奨案）

**根拠**:
- Sentry 公式 `Next.js on Cloudflare` guide が「`@sentry/nextjs` をインストール + wrangler を設定」の 2 段階を提示し、`@sentry/cloudflare` 併用を明示していない
- issue #14931（closed 2025-12-02）で「`@sentry/cloudflare` は `init` を export していないため Next.js 用途では使えない」と maintainer が結論
- `@sentry/nextjs >= 10.28.0` で event flushing 問題が修正され、Cloudflare 環境で本番運用可能になった

**必要な変更**:
1. `npm install @sentry/nextjs@latest` （>= 10.28.0）
2. `instrumentation.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` / `instrumentation-client.ts` を新規作成
3. `next.config.ts` を `withSentryConfig` でラップ
4. `wrangler.jsonc` の `compatibility_date` を `2025-08-16` 以降へ更新
5. Cloudflare Build variables に `NEXT_PUBLIC_SENTRY_DSN` を追加（DSN は public 値）
6. 場合により `next.config.ts` に `outputFileTracingIncludes: { "*": ["node_modules/@sentry/nextjs/build/**/*"] }` を追加（issue #18843 の workaround、build エラー予防）

### 5.2 `@sentry/cloudflare` 併用（不採用）

- 公式手順に存在しない
- `@sentry/cloudflare` の export に `init` がなく、Next.js のように複数箇所 (`server config` / `edge config`) から init する用途に適合しない
- `.open-next/worker.js` を別ファイルで wrap するパターン（plan §4-4 #6-a 案 2）は **Sentry 公式 docs にも OpenNext 公式 docs にも記載が無い** ため、自前検証と保守を引き受けるリスクが大きい

**併用が必要になるケース（fallback）**:
- `@sentry/nextjs` 単独で本番例外が捕捉できないことが #6-b 実装段階で判明した場合
- `AsyncLocalStorage` 関連 runtime error（issue #18842）が解消できない場合
- このときは Custom Worker パターンに切り替え:
  ```ts
  // src/sentry-worker.ts
  import { default as handler } from "./.open-next/worker.js";
  import * as Sentry from "@sentry/cloudflare";
  export default Sentry.withSentry(
    (env) => ({ dsn: env.SENTRY_DSN, tracesSampleRate: 0.1 }),
    { fetch: handler.fetch } satisfies ExportedHandler<CloudflareEnv>,
  );
  export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";
  ```
  + `wrangler.jsonc` の `"main"` を `src/sentry-worker.ts` に変更

---

## 6. wrangler.jsonc / compatibility 要件

### 6.1 必須更新

`compatibility_date: 2025-05-05` → **`2025-08-16` 以降**

引用（Sentry Next.js on Cloudflare guide）:
> set the compatibility date to `2025-08-16` or later. This is required to introduce `https.request` to the Cloudflare Workers runtime, which the Sentry SDK needs to send data

### 6.2 既設定済（変更不要）

- `compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"]` ✓
- `observability.enabled: true` ✓

### 6.3 sourcemap 用追加（任意）

`upload_source_maps: true` を `wrangler.jsonc` に追加すると、Wrangler の build pipeline で sourcemap を生成・upload する経路に乗る。ただし後述の通り OpenNext の出力 chain では完全な mapping は得られないため、コストパフォーマンス次第。

---

## 7. DSN・環境変数の扱い

### 7.1 DSN の性質と配置

Sentry DSN（`https://<pubkey>@o123456.ingest.sentry.io/123456` 形式）は **public 値**で、Sentry 公式 docs もコード内・client bundle への inline 露出を許容している。

**本リポジトリの規約に合わせた配置案**（CLAUDE.md の Cloudflare 環境変数ルール参照）:

| 変数名 | 配置 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Cloudflare **Build variables**（Build 必須） | client / server / edge すべての `Sentry.init({ dsn: ... })` で参照 |
| `SENTRY_AUTH_TOKEN` | Cloudflare **Build variables**（Build Secret） | sourcemap upload 用（採用時のみ） |
| `SENTRY_ORG` | Cloudflare **Build variables** | sourcemap upload 用（採用時のみ） |
| `SENTRY_PROJECT` | Cloudflare **Build variables** | sourcemap upload 用（採用時のみ） |

DSN は build 時 inline で十分。Runtime Secret (`process.env` 直読み禁止対象) ではないため、`cf-env.ts` の `getServerEnv()` を介する必要はない。

### 7.2 dev/staging との分離

`prepare-cloudflare-env.sh` が `WORKERS_CI_BRANCH=dev` 時に `STAGING_NEXT_PUBLIC_*` を `NEXT_PUBLIC_*` に写すパターンが既存（CLAUDE.md 参照）。Sentry も dev/staging 用に別プロジェクトを Sentry 側で作成し、`STAGING_NEXT_PUBLIC_SENTRY_DSN` として登録するのが整合的。

---

## 8. sourcemap upload

### 8.1 現実

- Sentry CLI で sourcemap upload は技術的に可能
- ただし issue #19213（open、最終 2026-02）が示す通り、**OpenNext は wrangler bundling 段階で sourcemap を生成しないため、`.open-next/worker.js` のスタックトレースを元 TypeScript ソースに完全に遡れない**
- 実用上は `handler.mjs` レベルの minified 名前で止まる

### 8.2 判断

本実装フェーズ #6-b では、以下の二択をユーザーに確認する想定:

| 案 | 内容 |
|---|---|
| A | sourcemap upload を **無効化**（`upload_source_maps: false`）。stack は minified だが本番反映までの設定が最小、Cloudflare Build に追加 secret 不要 |
| B | sourcemap upload を有効化。`SENTRY_AUTH_TOKEN` 等を Cloudflare Build Secret に追加。完全 mapping は得られないが、Next.js のコード単位までは元名で見える可能性あり |

初期は A で運用し、エラー追跡が現実的に困難と判明したら B に切り替える、が無難。

---

## 9. 既知の制約と対策

| # | 制約 | 出典 | 対策 |
|---:|---|---|---|
| 1 | Span durations 0ms（Cloudflare 仕様、`performance.now()` / `Date.now()` の進み方制限） | Sentry Cloudflare guide "Known Limitations" | 受け入れる。tracesSampleRate を 0.1 以下に絞り、span は補助情報扱い |
| 2 | `waitUntil()` 内の span 喪失 | 同上 | `Sentry.startSpan({ ..., forceTransaction: true }, () => ...)` で囲む（必要な箇所のみ） |
| 3 | sourcemap chain 壊れ | issue #19213 | §8 の通り。初期は sourcemap 無効で運用 |
| 4 | `Could not resolve "@sentry/nextjs"` build エラー（pnpm/monorepo で発生報告） | issue #18843 | npm 単一 lockfile で運用中の本リポでは発生確率低。発生時は `next.config.ts` に `outputFileTracingIncludes` workaround |
| 5 | `AsyncLocalStorage` runtime error（`captureRequestError` 経路） | issue #18842 | v10.28.0+ で改善見込みだが v10.33.0 でも再発報告あり。**#6-b 実装後、管理者専用 endpoint での throw 検証で必ず確認**。再発時は `instrumentation.ts` の `onRequestError` export を一時的に外して client only に縮退 |
| 6 | Session Replay は client side のみ | Sentry docs | server エラーには replay 不要、想定通り。`replaysSessionSampleRate: 0` で初期化 |
| 7 | `@sentry/nextjs >= 10.28.0` 必須 | issue #14931 | install 時に明示 |

---

## 10. テスト throw の安全条件（plan §4-4 #6-b 再掲）

ユーザー指示通り、テスト throw endpoint・spike 用一時コードは **本実装に絶対に残さない**。本実装段階で動作確認する際は、以下のいずれかに限定する:

- **同一 PR 内で削除を完了する一時コード**（commit 7-1 で追加、commit 7-N で削除、main へは削除済の差分のみ流す）
- もしくは `INTERNAL_API_KEY` 等で保護された **管理者専用 endpoint**（`getServerEnv("INTERNAL_API_KEY")` で検証する形）
- 公開ユーザーが叩けない導線に限定。本番でも到達確認後にコードを削除

本 spike では throw コードは一切実装していない。

---

## 11. 代替候補（Sentry が動かない場合のフォールバック軽い比較）

Sentry が本実装 (#6-b) で動作不能と判明した場合に検討する候補。本 spike では概要のみ。

| 候補 | 性質 | OpenNext + Cloudflare 適合性 | 個人開発スコープでの位置付け |
|---|---|---|---|
| **Cloudflare Workers Logs Engine**（内蔵） | Worker のログ・例外を Cloudflare 側で集約・検索 | ✅ 既に有効（`observability.enabled: true`） | error grouping・通知機能なし。**aggregation のみで Sentry 代替にはならない**。並用扱い |
| **Better Stack (Logtail)** | Log aggregation + alerting + status pages | Cloudflare Logpush 経由、または Logtail Worker SDK あり | 月 1GB / 3 day retention で無料。Cloudflare 寄り、Logflare より UI 洗練 |
| **Logflare** | Log aggregation（BigQuery バックエンド） | Cloudflare Logpush 経由が公式 | Supabase が買収済で関連。Sentry のような stack trace grouping は弱い。Sentry 不可時の `console.error` 集約用 |
| **Glitchtip**（OSS / self-hosted） | Sentry 互換 SDK でセルフホスト | `@sentry/cloudflare` の DSN を Glitchtip サーバに向ければ理論上動作 | self-hosted のため運用コスト高。個人開発では費用対効果薄い |
| **Bugsnag** / **Rollbar** | 商用 error tracker | Next.js SDK あり、Cloudflare 専用 SDK は薄い | Sentry 同等の価格帯、移行コスト相応 |

**判断**: 当面 Sentry が公式に Next.js on Cloudflare をサポートする方針を打ち出しているため、Sentry を第一候補で進めて差し支えない。フォールバックは「Cloudflare Workers Logs Engine（既に有効、補助情報）」+「Better Stack または Logflare（必要なら Logpush 連携）」の組み合わせを想定しておく。

---

## 12. Sentry Pricing（参考）

| 項目 | Developer (Free) | Team ($26/mo) |
|---|---:|---:|
| Errors | 5,000 / 月 | 50,000 / 月 |
| Spans | 5M / 月 | 5M / 月 |
| Replays | 50 / 月 | 50 / 月 |
| Cron Monitors | 1 | 1 |

**tierlog のスコープでの見立て**:
- DAU 数十〜数百、月 PV 数千〜数万を想定
- 通常運用では errors 5k/月 を下回る見込み → **Developer Free で十分**
- ただし本番反映直後にバグで error 数が急増すると Free 枠を一気に超える可能性あり
- 初期は `tracesSampleRate: 0.1` 以下、`replaysSessionSampleRate: 0` で span/replay 枠を温存

---

## 13. 実装方針案（#6-b 着手時に確認したい論点）

spike 結果を踏まえた #6-b 本実装の方針案。**実装着手前にユーザー判断を仰ぐ論点**を ★ で示す。

### A. 採用構成（推奨）

1. `@sentry/nextjs@>=10.28.0` を npm install
2. ファイル新規作成:
   - `instrumentation.ts`（root）— `NEXT_RUNTIME` 分岐で server/edge config を import、`captureRequestError` を export
   - `sentry.server.config.ts`
   - `sentry.edge.config.ts`
   - `instrumentation-client.ts`
3. `next.config.ts` を `withSentryConfig` でラップ
4. `wrangler.jsonc` の `compatibility_date` を `2025-08-16` に更新
5. Cloudflare Build variables に `NEXT_PUBLIC_SENTRY_DSN` 追加（dev/prod 別、`STAGING_NEXT_PUBLIC_SENTRY_DSN` も）
6. 初期サンプル比率: `tracesSampleRate: 0.1`、`replaysSessionSampleRate: 0`
7. **動作確認**: dev preview で管理者専用 endpoint 経由の throw → Sentry 到達確認 → 検証 endpoint 削除（同一 PR 内）

### B. ユーザー判断ポイント

- **★ Sentry organization/project の事前準備**: 既存に Sentry アカウントを持っているか、新規作成するか
- **★ sourcemap upload 採用可否**: §8 の A（無効）か B（有効）か
- **★ 通知先**: Sentry alert を email / Discord webhook / 他のどれにするか（plan §8 [通知先] が未解決）
- **★ dev/staging Sentry プロジェクト**: 本番と分けるか、まず本番のみで運用するか
- **★ `compatibility_date` の更新タイミング**: Sentry 導入 commit と一緒に上げるか、先行して別 commit にするか
- **★ `outputFileTracingIncludes` workaround の予防的適用**: 入れておくか、build エラーが出てから対処するか

### C. 推奨実装順（#6-b）

1. `wrangler.jsonc` の `compatibility_date` を `2025-08-16` に更新（先行 commit、build に影響しないことを確認）
2. `npm install @sentry/nextjs@latest` + 上記 4 ファイル新規作成
3. `next.config.ts` の `withSentryConfig` ラップ
4. Cloudflare Build variables 設定（ユーザー側で実施）
5. dev push → preview ビルド成功確認 → 管理者専用 endpoint で throw 検証 → 削除
6. main 反映前にユーザー smoke test
7. main 反映後、Sentry dashboard に本番エラーが流れることを確認

加えて #6-b 完了後、`docs/runbooks/` 配下に 5 件の runbook を追加（plan §4-4 B）。それぞれ公式 docs 参照リンク + 取得日付き。

---

## 14. 残された判断・未確定事項

- 本 spike では Sentry を「動かす方針」までを確定。**実際の動作（特に AsyncLocalStorage 問題と sourcemap chain）は #6-b 実装後の検証で初めて判明する**
- `outputFileTracingIncludes` workaround の要否は本リポジトリの npm install パターンで build を一度通してみるまで未確定
- Sentry Dashboard alert 通知先・通知ルールは #6-b 実装時に確定

---

## 15. 関連ファイル

- plan: `docs/plans/2026-05-24_pre_public_blocker_resolution_plan.md` §4-4 #6-a / #6-b
- 元レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` §4-4
- 直前報告書: `docs/reports/2026-05-24_lint_errors_resolution.md` / `docs/reports/2026-05-24_legal_pages_first_draft.md`
- 実 OpenNext 生成物: `.open-next/worker.js`（2026-05-19 生成）
- Cloudflare 設定: `wrangler.jsonc` / `open-next.config.ts` / `next.config.ts`
