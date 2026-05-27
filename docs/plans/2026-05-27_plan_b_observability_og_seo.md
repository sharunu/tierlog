# Plan B: Observability / OG / SEO

- 作成日: 2026-05-27
- 作成者: Claude Code (Opus 4.7)
- 元レポート: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` §4.5 / §4.6 / §4.7 / §5.1-5.3
- Plan A 完了報告: `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md`
- ステータス: **完成 / 実装可能水準** (plan-critic 累計 12 反復 + Codex 第 1 回 / 第 2 回 / 第 3 回 / 第 4 回 / 第 5 回指摘反映完了、未解決質問ゼロ)
- 想定ブランチ: `dev`
- **本 plan ファイルの取り扱い**:
  - 本 plan は **plan 作成専用チャット** で作成。実装は **別チャット** で開始する設計。
  - **本 plan 作成チャットでは実装に入らない**。コード編集 / DB 変更 / commit / push / 外部サービス操作 / ダッシュボード操作は一切しない。plan ファイル編集のみ。
  - 実装着手は、ユーザーが別チャットで「実装してください」と明示指示した時点から開始する。`AGENTS.md` / `CLAUDE.md` / 本 plan §2 を実装チャットで再度参照する。

---

## 0. 目的とスコープ

統合 audit §4.5 / §4.6 / §4.7 / §5.1-5.3 のうち、**Observability / OG / SEO** に該当する部分を 1 つの実装単位にまとめた plan。Plan A (`shares.image_url` 対策・legacy URL・BanGuard・auth game/next) が完了した上で、一般公開前に **Sentry の PII 漏洩リスク、OG 画像生成の SPOF、SEO/index 制御の不備、Cloudflare Web Analytics と Sentry/logs の責任分界、公開ランディングと法務導線の現状確認** を実施する。

### 含めるもの

- B-1 Sentry scrubber / release / environment 整備 (P1)
- B-2 OG ルートの外部フォント依存解消 + cache/error fallback (P1)
- B-3 noindex / 各 page metadata / dev preview index 防止 (P1)
- B-4 公開ランディング + sitemap 整理 (P1)
- B-5 Cloudflare Web Analytics / Sentry / Logs の責任分界明文化 (P2)
- B-6 法務・公開導線の現状確認と不足項目リストアップ (P2、実装は別 plan)

### 含めないもの (別 plan)

- **Plan A で完了済の再実装は禁止**: `shares.image_url` 二段防御 / legacy URL / BanGuard fail-open + retry / auth `game`/`next` 引き継ぎ + open redirect helper / `loading.tsx` / `global-error.tsx`。
- マルチゲーム DB スコープ (`get_team_member_summaries` / detection / quality scoring) → Plan C
- ban / suspended / unpaid access gate / `if (!user) return []` 統一 / middleware session refresh → Plan D
- 期限切れ share 公開停止 / share/OG DB error と 404 分離 / public GET cache rate-limit → Phase 2 plan
- 初回オンボーディング / `recharts` lazy / Discord refresh / `npm test` 復旧 → Plan E (Phase 2)
- billing / 広告タグ実装 / consent UI / 特商法表記実装 → Phase 3 plan (本 plan B-6 で **現状確認のみ**実施、実装は Phase 3)
- 任意外部 `image_url` の再許可: **禁止** (Plan A 完了済の防御を後退させない)
- `getUser()` を `getSession()` に一括置換: **禁止** (Codex 指摘で確定済)
- auth 設定 (implicit flow / `client.ts` / `middleware.ts` / `auth/callback` 既存 SIGNED_IN 処理) の根本変更: **禁止**

---

## 1. 関連 plan との依存関係

| Plan | 内容 | Plan B との関係 |
|---|---|---|
| **Plan A (完了)** | UI/route 修正 + `shares.image_url` 二段防御 | **完了済**。Plan B は Plan A の helper (`sanitizeShareImageUrl` / `normalizeSupabaseStoragePrefix`) を維持し改変しない |
| **Plan B (本 plan)** | Observability / OG / SEO | — |
| Plan C: Multi-Game DB Scope | team / detection / quality scoring の game scope | 独立。並行可能。ただし migration を含むため B と並行する場合は staging 適用順序を調整 |
| Plan D: Access Gate / Auth Expiry | ban / suspended / unpaid 強制、`getUser()` 用途整理、middleware session refresh、`if (!user) return []` 統一 | 関連あり。**B-3 で `/account` などに noindex を入れた page の挙動を Plan D が再設計する想定**。B 先行で問題なし |
| Plan E (Phase 2) | onboarding / perf / Discord / test 復旧 | B 後 |
| Phase 3 plan | billing / ads / consent / legal | B-6 の現状確認結果を入力として Phase 3 の plan を起案 |

**実装順序の推奨**: Plan B を Plan C / Plan D と独立して先行可能。DB migration を含まない (sub-task ゼロで DB 変更なし) ため staging 検証期間が短くて済む。

---

## 2. プロジェクト固有ルールの厳守事項

`AGENTS.md` / `CLAUDE.md` から本 plan に直結する制約:

- **`main` への直接 push 禁止**。全変更を `dev` ブランチで実装し、ユーザーの「本番反映」明示指示を待ってから `main` へ merge する。
- **`dev` への commit/push は実装完了時点で Claude が自動実施可**。本番影響なし。
- **production DB 変更禁止**。本 plan は **DB 変更を含まない** (B-1〜B-6 すべて code-only)。
- **Supabase / Cloudflare / Sentry 等の外部サービス dashboard 操作は本 plan 作成チャットでは実施しない**。
- **dashboard 操作手順を plan に含める場合は、必ず公式ドキュメント確認 (WebFetch) を前提条件として明記する** (AGENTS.md 厳守)。
- **既存 auth 設定 (implicit flow / `client.ts` / `middleware.ts` / `auth/callback/page.tsx` の SIGNED_IN 処理) は変更しない**。
- **`getUser()` を `getSession()` に一括置換しない**。
- **任意外部 `image_url` を再許可する方向に戻さない** (Plan A の二段防御を維持)。
- **Plan A 完了済 4 件 (`shares.image_url`, auth `game`/`next`, BanGuard fail-open, legacy URL) は再実装しない**。
- **URL ハードコード禁止**。`process.env.NEXT_PUBLIC_APP_URL` か `window.location.origin` 経由。
- **Runtime secret は `getServerEnv()` 経由**。本 plan の Sentry DSN は既に `env.SENTRY_DSN` 経由で取得済 (`src/sentry-worker.ts`)。
- **`npx next build` / `npm run deploy` は本 plan 作成チャットで実行しない**。検証は `npm run lint` / `npx tsc --noEmit` / `npm test` / `curl` などで完結させる。

---

## 3. サブタスク詳細

### B-1: Sentry scrubber / release / environment 整備 (P1)

#### 背景 / 解決したい穴

`src/sentry-worker.ts` の現状 (Plan A 完了時点) で **`beforeSend` / explicit scrubber / `sendDefaultPii: false` / `release` が未設定**。`@sentry/cloudflare` の default 動作で Authorization / Cookie / token らしき値が Sentry に送信されるリスクが残る (公開後に PII / Bearer JWT / Supabase service_role key 等が 3rd party に流出する事故源)。`environment` 判定は `env.NEXT_PUBLIC_SUPABASE_ENV` 依存で、Runtime セクションへの設定有無で staging / production が誤判定される可能性。`release` 未設定で Cloudflare deploy id と Sentry issue が紐付かず、公開直後の連続 deploy 期に MTTR 悪化する。

#### 対象ファイル候補

- `src/sentry-worker.ts` (Custom Worker entry)
- `wrangler.jsonc` (Cloudflare version metadata binding 追加判断)
- `docs/runbooks/sentry-runbook.md` (Plan B-5 で新規作成する Sentry 専用 runbook、本 sub-task の実装内容を運用手順として記述する場合)
- ユーザーへの案内 (実装チャット側): Cloudflare ダッシュボード Variables and Secrets (Runtime) への `SENTRY_DSN` / `NEXT_PUBLIC_SUPABASE_ENV` 登録確認

#### 実装方針

##### B-1-a: `sendDefaultPii: false` 明示

- `Sentry.withSentry((env) => ({ dsn: ..., sendDefaultPii: false, ... }))` で明示。
- 既存の Sentry SDK default では `sendDefaultPii` は false だが、明示化により設定変更ミス検知を容易にする。

##### B-1-b: `beforeSend` scrubber

`beforeSend(event)` ハンドラを追加し、以下の機微情報を **削除または `[Filtered]` に置換**する:

- **HTTP headers** (`event.request?.headers`): `authorization`, `cookie`, `set-cookie`, `x-internal-key`, `x-supabase-*`, `apikey` (case-insensitive)。
- **URL query string** (`event.request?.query_string` または `event.request?.url`):
  - `access_token`, `refresh_token`, `id_token`, `provider_token`, `provider_refresh_token` などの token 系
  - `code`, `state` (OAuth callback の認可コード / CSRF state)
  - `apikey` (Supabase publishable/anon key が誤って URL に乗った場合)
  - 全体は parse して該当パラメータの値のみ `[Filtered]` に置換 (key=value 形式を維持しつつ value だけ伏字)
- **request body** (`event.request?.data`): JSON body 全体を残す場合、`password`, `access_token`, `refresh_token` などの key を持つフィールドを **再帰的に walk して** 値を `[Filtered]` に置換する (深いネストも対応)。サイズが大きすぎる場合は body 全体を `[Filtered]` で置換する閾値 (例: 16KB) を設ける。
- **breadcrumbs**: 同様に fetch / xhr の URL と headers に対しても scrub を適用 (Sentry SDK の breadcrumb は default で fetch を捕捉する)。
- **extra / tags / contexts**: Supabase URL / key が混入していないか確認、混入時は伏字。
- **user 情報**: `event.user.email` / `event.user.username` などは `sendDefaultPii: false` でも明示的に削除しておく (二重防御)。

実装パターン例 (擬似コード):

```ts
function scrubHeaders(headers: Record<string, string> | undefined) {
  if (!headers) return headers;
  const SENSITIVE = /^(authorization|cookie|set-cookie|x-internal-key|x-supabase-.*|apikey)$/i;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE.test(k) ? "[Filtered]" : v;
  }
  return out;
}

function scrubUrlQuery(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url, "http://localhost"); // relative URL も parse できるよう base 指定
    const SENSITIVE_PARAMS = ["access_token", "refresh_token", "id_token", "provider_token", "provider_refresh_token", "code", "state", "apikey"];
    for (const k of SENSITIVE_PARAMS) {
      if (u.searchParams.has(k)) u.searchParams.set(k, "[Filtered]");
    }
    return u.toString();
  } catch {
    return url; // malformed URL は触らない
  }
}
```

`beforeSend` の return 値で `event` を改変して返す。Sentry SDK の event schema (`@sentry/types` の `Event`) に従う。

##### B-1-c: `release` 設定 (RD-B3 で確定済)

`release` を Cloudflare Workers の **Version Metadata Binding** (`env.CF_VERSION_METADATA?.id`) から取得する。

実装内容 (RD-B3 反映):

1. `wrangler.jsonc` に **`version_metadata: { binding: "CF_VERSION_METADATA" }` を追加** (plan 上で許可済)。
2. `src/sentry-worker.ts` の `SentryWorkerEnv` 型に `CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string }` を追加。
3. `Sentry.withSentry((env) => ({ ..., release: env.CF_VERSION_METADATA?.id ?? "unknown", ... }))` で渡す。
4. **fallback**: binding 未設定 / 値 undefined の場合は `"unknown"` を渡す。

**実装チャット側必須事項**: AGENTS.md「外部サービス操作前に WebFetch で公式ドキュメント確認」厳守。Cloudflare Workers Version Metadata Binding の公式 docs を取得し、`nodejs_compat` 互換性 / staging と production で別 binding が必要か等を確認した上で wrangler.jsonc を編集する。

棄却した案: Build variable (`WORKERS_CI_COMMIT_SHA`) 経由は Custom Worker entry での到達性が不確実、Version Metadata Binding が標準経路として採用。

##### B-1-d: `environment` 判定の確実化

現状: `env.NEXT_PUBLIC_SUPABASE_ENV === "staging" ? "staging" : "production"`。

問題: `NEXT_PUBLIC_SUPABASE_ENV` は Build 変数として `prepare-cloudflare-env.sh` で staging branch のみ "staging" に書き換えられる。**Custom Worker entry (`src/sentry-worker.ts`) は Runtime 経由で env を受けるため、Runtime セクションに `NEXT_PUBLIC_SUPABASE_ENV` を別途登録しないと届かない可能性**がある。

修正方針 (二段判定):

- **第一候補**: Runtime セクションに `NEXT_PUBLIC_SUPABASE_ENV` を登録する手順を実装チャット側で確認する。これがあれば `env.NEXT_PUBLIC_SUPABASE_ENV` で判定可能。
- **第二候補 (fallback)**: `request.url` の host を見て判定する `beforeSend` 内の追加処理 (host が RD-B1 と同じ固定値 `dev-duepure-tracker.jianrenzhongtian7.workers.dev` に一致する場合のみ staging、それ以外 production)。広い `*.workers.dev` substring/regex 判定は RD-B1 と同じ理由 (本番が同 subdomain を持つ別 worker.dev URL を持つ場合の誤発火リスク) で採らない。ただし host による判定は Custom Worker entry が request handler でしか取れないため、`Sentry.withSentry` の env config 段階では使えない。代替として **判定を `beforeSend` 内で `event.tags.environment` を上書きする** 方式は可能 (Sentry の environment は event 生成時点で確定するが、後付け tag で識別可能)。

判断: **第一候補 (Runtime セクション登録) を採用**。実装チャット側で Cloudflare ダッシュボード設定確認手順を runbook 化。第二候補は補助。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| `sendDefaultPii` 明示 | `git grep -n "sendDefaultPii" src/sentry-worker.ts` | `false` が明示されている |
| Headers scrub | staging で意図的に Sentry に `Authorization: Bearer <token>` 付きリクエストでエラーを発生させ、Sentry ダッシュボードの event payload の `request.headers.authorization` を確認 (**実装チャット側で実施、本 plan 作成チャットでは確認しない**) | `[Filtered]` になっている |
| URL query scrub | 同様に `?access_token=<value>` 付きリクエストでエラーを発生 | `?access_token=[Filtered]` になっている |
| `release` 設定 | Sentry ダッシュボードで最新 issue の Release 欄を確認 | Cloudflare deploy id (commit SHA 等) が表示される |
| `environment` 判定 | dev preview と本番でそれぞれエラーを発生させ Sentry ダッシュボードの Environment フィルタを確認 | dev preview = `staging`、本番 = `production` で分離される |
| 既存挙動 | staging で Sentry に通常エラー (例: `/api/og/<invalid-id>` の 404) を送信し、レポートが届くこと | event 受信、stack trace 表示 |

#### リスク / rollback

- **リスク 1**: `beforeSend` で `event` の構造を壊すと **Sentry にイベントが届かなくなる**。各 scrubber を `try/catch` でラップし、エラー時は **元の event を返す** (scrub 失敗で event を捨てない) 設計にする。
- **リスク 2**: Version Metadata Binding 追加で `wrangler.jsonc` の互換性が変わる可能性。実装チャット側で `wrangler types` 後の TypeScript 型確認を必須にする。
- **rollback**: `git revert` で `src/sentry-worker.ts` を Plan A 完了時点に戻す。`wrangler.jsonc` の binding 追加分も同じ commit で revert すれば元に戻る。Sentry ダッシュボード側の設定変更は不要 (DSN は変更しない)。

#### Plan A との依存関係

- Plan A の `src/sentry-worker.ts` は **改変対象**だが、`Sentry.withSentry` の基本構造 (DSN 取得 + handler 透過) は維持する。Plan A の `Sentry.withSentry((env) => ({ ... }), { fetch: handler.fetch })` の枠組みはそのまま、config object を拡張する形。
- Plan A 完了報告 §7.3 で「Plan B 対象」と明示済。

---

### B-2: OG ルートの外部フォント依存解消 + cache/error fallback (P1)

#### 背景 / 解決したい穴

`src/app/api/og/[id]/route.tsx` の `getFontFromGoogle()` は **Google Fonts CSS+TTF を毎リクエスト fetch** している。`FONT_CACHE` は module-scoped で isolate 内のみ有効 (Cloudflare Workers の cold start で消える)。SNS bot (X / Discord / Slack) が OGP プレビューを大量取得する瞬間に Google Fonts への外部 fetch が失敗すると **OG 生成が 500 を返し SNS プレビューが壊れる**。Cloudflare Workers の sub-request quota (Free 50 / Paid 1000 per request) を消費する点も問題。`src/assets/fonts/NotoSansJP-Bold.ttf` (9.1MB) はリポジトリにあるが未参照、regular weight は未同梱。

#### 対象ファイル候補

- `src/app/api/og/[id]/route.tsx` (フォント取得ロジックと ImageResponse)
- `src/assets/fonts/NotoSansJP-Bold.ttf` (既存ファイル、bundle 化)
- `src/assets/fonts/NotoSansJP-Regular.ttf` (新規追加判断、後述)
- 関連 helper: `src/lib/og/fonts.ts` (新規、フォント読み込み helper)

#### 実装方針

##### B-2-a: フォントのローカル同梱

- `src/assets/fonts/NotoSansJP-Bold.ttf` を **import 経由で ArrayBuffer に変換** する方式を採用。実装案 2 つ:
  - **案 (i)**: `import fontData from "@/assets/fonts/NotoSansJP-Bold.ttf"` (Next.js の asset module パターン、`next.config.ts` の `experimental.turbo.rules` または webpack loader で `*.ttf` を ArrayBuffer として import 可能化)。
  - **案 (ii)**: Cloudflare Workers の ASSETS binding 経由で fetch する方式 (`await env.ASSETS.fetch(new URL("/fonts/NotoSansJP-Bold.ttf", "http://localhost"))` のような形)。フォントを `public/fonts/` に置けば自動で ASSETS に含まれる。
- **判断**: **案 (ii) を推奨**。理由: (a) Next.js の asset import は OpenNext build の互換性確認が別途必要、(b) ASSETS binding は wrangler.jsonc で既に `binding: "ASSETS"` 設定済で、`public/` を serve する標準経路 = 検証コスト低。
- 移動先: `public/fonts/NotoSansJP-Bold.ttf` (既存 `src/assets/fonts/` から移動するか copy するかは実装判断、ただし repo size 削減のため移動推奨)。
- **regular weight 同梱の判断 (RD-B4 で確定済)**:
  - **regular + bold の両方を同梱する** (`public/fonts/NotoSansJP-Regular.ttf` 新規 + `public/fonts/NotoSansJP-Bold.ttf` 既存移動)。
  - 理由: Bold のみだと「数字や副題が太字ばかり」になり可読性が落ちる。
  - **repo size 増加**: regular 約 9MB + bold 約 9MB = 計 約 18MB の git tracked binary 増。実装時に commit する。ASSETS binding 経由なので **Worker bundle size には影響しない**。
  - **subsetting (常用漢字 + ひらがな + カタカナ等のみ抽出)** は **Phase 2 / optional**。本 plan では full set を使う (実装複雑度を抑えるため)。約 1〜2MB まで削減可能だが本 plan スコープ外。

##### B-2-b: フォント取得の helper 化と fallback

新規 `src/lib/og/fonts.ts` に以下を実装:

```ts
type FontWeight = 400 | 700;
type FontEntry = { name: "NotoSansJP"; data: ArrayBuffer; weight: FontWeight; style: "normal" };

let FONT_CACHE: FontEntry[] | null = null;

export async function loadOgFonts(assetsBinding: Fetcher | undefined): Promise<FontEntry[]> {
  if (FONT_CACHE) return FONT_CACHE;
  if (!assetsBinding) return []; // fallback: フォントなしで render
  try {
    const [regular, bold] = await Promise.all([
      assetsBinding.fetch("http://localhost/fonts/NotoSansJP-Regular.ttf").then(r => r.arrayBuffer()),
      assetsBinding.fetch("http://localhost/fonts/NotoSansJP-Bold.ttf").then(r => r.arrayBuffer()),
    ]);
    FONT_CACHE = [
      { name: "NotoSansJP", data: regular, weight: 400, style: "normal" },
      { name: "NotoSansJP", data: bold, weight: 700, style: "normal" },
    ];
    return FONT_CACHE;
  } catch (e) {
    console.error("loadOgFonts failed:", e);
    return []; // フォント取得失敗時はフォントなしで render
  }
}
```

- `assetsBinding` は Cloudflare Workers の `ASSETS` binding (Custom Worker から取得)。`getCloudflareContext()` 経由で取得する。
- **取得失敗時 (catch)** は **空配列を返してフォントなしで ImageResponse を生成**する。これにより SNS プレビューが完全に壊れるよりは「フォントが OS デフォルトに崩れた画像」を出す方が好ましい。
- module-scoped cache (`FONT_CACHE`) を維持。同一 isolate 内の以降のリクエストで再フェッチを避ける。

##### B-2-c: OG route の `try/catch` で全体保護

- `route.tsx` の `GET` 関数全体を `try/catch` で囲い、最終 catch でフォールバック画像 (404 ではなく 500 でもなく **`Response.redirect("/og-default.png", 302)` のような汎用 fallback**) を返す。
- ただし `Response.redirect` の URL は **絶対 URL 必須** (`new URL("/og-default.png", request.url).toString()` で組み立てる)。
- `public/og-default.png` を新規追加する (1200x630 PNG、ブランドロゴ + 「Tierlog」テキストの最低限の画像)。
- **既存の 404 経路 (share が見つからない場合) は維持** する。404 自体はエラーではなく正規動作。catch するのは想定外例外のみ。

##### B-2-d: Workers Cache API による OG response cache

現状 OG route の response header (`Cache-Control: public, max-age=604800, immutable`) は付与済の可能性があるが、Cloudflare のエッジ cache に乗っているかは未確認。

修正方針:

- **環境フォールバック** (Codex 第 3 回追加、RD-B10):
  - `globalThis.caches?.default` が無ければ **cache layer 全体をスキップ** する (`caches` は Cloudflare Workers ランタイム特有の global、ローカル `next dev` / Node テスト環境では存在しない)。
  - 実装パターン: `const cache = globalThis.caches?.default; if (!cache) { return await renderOg(...); }` のような形で early return。
  - `getCloudflareContext()` の呼び出しは **`try/catch` で囲む** (ローカル dev で throw する可能性、Custom Worker 経由でない呼び出しでも安全)。失敗時は `ctx.waitUntil` を使わず `await cache.put(...)` で同期書き込みに fallback。
- **cache 動作の検証** (Codex 第 3 回追加、RD-B10):
  - `cf-cache-status: HIT` は Cloudflare のエッジ cache (Workers Cache とは別レイヤ) の値で、Workers Cache API のヒット判定としては **確実ではない**。
  - 代わりに **独自ヘッダ `X-Tierlog-OG-Cache: HIT | MISS` を OG response に付与**し、curl での検証で確実に判定できるようにする。
  - 実装: cache hit 時に response header に `X-Tierlog-OG-Cache: HIT` を付与、miss 時は ImageResponse 生成後に `X-Tierlog-OG-Cache: MISS` を付与してから cache.put。
- `globalThis.caches.default.match(request)` で cache hit を確認、hit なら独自ヘッダ `X-Tierlog-OG-Cache: HIT` を付けて即返す。
- miss なら通常通り ImageResponse 生成 + 独自ヘッダ `X-Tierlog-OG-Cache: MISS` 付与。`getCloudflareContext()` 経由で `ctx.waitUntil(cache.put(request, response.clone()))` で cache 書き込み (`route.tsx` は `runtime = "nodejs"` のため Next.js handler signature には `ctx` が渡されない、OpenNext 経由で取り出す)。`getCloudflareContext()` が undefined / throw の場合は `await cache.put()` で同期書き込みする fallback。
- 同一 share ID へのバースト (SNS バズ時) を CDN レベルで吸収。
- TTL は 7 日 (`max-age=604800`)、share 削除時の cache invalidate は **本 plan スコープ外** (期限切れ share 公開停止と合わせて Phase 2 で対応)。

##### B-2-e: 共有画像 (Storage) と動的 OG fallback の役割整理

Plan A で確立した役割分担を **文書化**する (新規実装ではなく既存設計の明文化):

| 経路 | 役割 | 出典 |
|---|---|---|
| `share.image_url` (Storage URL) | ShareModal で生成した html2canvas 画像。SNS プレビューの主経路 | Plan A A-1 sanitizer 通過後 |
| `/api/og/[id]` (next/og 動的生成) | `share.image_url` が無効 (`sanitizeShareImageUrl` で `null`) または未設定の場合の fallback | Plan A A-1 display sanitizer |
| `public/og-default.png` (静的画像) | OG route 自体が想定外例外で死んだ場合の最終 fallback (B-2-c 新規) | 本 plan で追加 |

- 共有ページ (`/share/[id]/page.tsx`) と OG API (`/api/og/[id]/route.tsx`) は **同じ二段防御** を使う (Plan A 完了済の `sanitizeShareImageUrl`)。Plan B では **これを変更しない**。
- B-2 で追加する `og-default.png` は **第三段の最後の砦**。実用上はほぼ通らないが、想定外例外時のブランド一貫性のために用意。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| Google Fonts fetch の廃止 | `git grep -n "fonts.googleapis.com\|getFontFromGoogle" src/` | ヒットゼロ |
| ローカルフォント参照 | `ls public/fonts/` | `NotoSansJP-Bold.ttf` と `NotoSansJP-Regular.ttf` が存在 |
| ASSETS binding 経由のフォント取得 | dev preview で `/api/og/<existing-share-id>` を curl | 200 OK、画像 binary が返る |
| フォント取得失敗時の fallback | (実装チャットで) Workers のローカル mode で ASSETS を mock 無効化して curl | 画像 binary が返る (フォント無しでも render 成功) |
| 想定外例外時の最終 fallback | (実装チャットで) ImageResponse 生成段階で意図的に throw する mock | `og-default.png` への 302 redirect が返る |
| Workers Cache 動作 (RD-B10 確定の独自ヘッダ検証) | curl で同じ ID を 2 回叩き、2 回目の response header に `X-Tierlog-OG-Cache: HIT` (1 回目は `MISS`) | 2 回目はキャッシュヒット (`cf-cache-status` は Workers Cache とは別レイヤなので独自ヘッダで判定) |
| ローカル / Node 環境での fallback (RD-B10) | `npm run dev` (ローカル) で `/api/og/<id>` を curl | cache layer がスキップされても 200 OK + 画像 binary、独自ヘッダなし (`globalThis.caches` 不在環境) |
| 既存 share の OG 動作 | 本番既存 share の OG プレビューが崩れない | Plan A 完了時の見た目と同一 |

#### リスク / rollback

- **リスク 1**: ASSETS binding 経由のフォント取得が Custom Worker entry で正しく動かない可能性。`src/sentry-worker.ts` で wrap している `handler.fetch` の中で `getCloudflareContext()` 経由の ASSETS が解決できるか実装チャットで検証必須。
- **リスク 2**: regular weight 同梱で `public/fonts/` サイズが約 18MB 増。`public/` は ASSETS binding 経由で配信されるため Worker bundle size には影響しないが、git repo size は増える。サブセット化で削減可能。
- **リスク 3**: Workers Cache API の cache key 衝突 (異なる share ID で同じ cache を引く事故)。`caches.default.match(request)` の request URL を key として使うため、share ID が URL に含まれていれば衝突なし (現状 `/api/og/[id]` は ID を path に含むので OK)。
- **rollback**: `git revert` で `src/app/api/og/[id]/route.tsx` を Plan A 完了時点に戻す。`public/fonts/` の追加分は削除。`og-default.png` も削除。

#### Plan A との依存関係

- Plan A の `sanitizeShareImageUrl` / `normalizeSupabaseStoragePrefix` (`src/lib/share/image-url.ts`) は **そのまま使う**。Plan B では改変しない。
- Plan A の `loadStoragePublicUrlPrefix` (`src/app/api/og/[id]/route.tsx` 内) も維持。
- 二段防御 (DB trigger + display sanitizer) は維持。Plan B が追加するのは **第三段の最終 fallback** のみ。

---

### B-3: noindex / 各 page metadata / dev preview index 防止 (P1)

#### 背景 / 解決したい穴

統合 audit §4.7:

- `/admin` / `/auth` / `/account` 等は `robots.txt` Disallow だけでは外部リンク経由 index を防げない。
- 各 page の metadata が重複しがちで、共通 OGP / canonical も弱い。
- dev preview (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) が本番と同じ index/follow 設定で、検索エンジンに重複コンテンツとして index されるリスク。
- `/share/[id]` の OGP と index/noindex 方針が未確定 (個人戦績スクショを検索結果に出すべきか議論未収束)。

#### 対象ファイル候補

- `src/app/layout.tsx` (root metadata の `robots`)
- `src/app/admin/layout.tsx`, `src/app/account/layout.tsx`, `src/app/auth/layout.tsx` または各 page (新規作成判断)
- `src/app/share/[id]/page.tsx` (Plan A で `generateMetadata` 既存、index/noindex を追加判断)
- ~~`src/app/{dm,pokepoke}/{home,battle,decks,stats}/page.tsx`~~ **編集対象外** (RD-B2 ハイブリッド方針 + Codex 第 2 回確定: アプリ内部 page は Plan B では触らない。確認のみ可、metadata 追加 / server wrapper + client core 分割は禁止)
- ~~`src/app/admin/layout.tsx`, `src/app/account/layout.tsx`, `src/app/auth/layout.tsx` または各 page (新規作成判断)~~ **client page 分割なし** (Codex 第 2 回確定)。`/admin` `/account` `/auth` は `next.config.ts` `X-Robots-Tag` header での noindex 付与のみを基本とし、既存 **server** layout に安全に `metadata.robots` を追加できる場合のみ補助併用可
- `next.config.ts` (`headers()` の `X-Robots-Tag` 追加、RD-B1 dev preview noindex + B-3-a per-path noindex)
- `src/app/sitemap.ts` (Plan B-4 で別途整理、ここでは触れない)

#### 実装方針

##### B-3-a: noindex 対象 path の確定

| Path | 方針 | 実装手段 (Codex 第 2 回反映で確定) |
|---|---|---|
| `/admin` 配下 | **noindex, nofollow** (管理者専用) | **`next.config.ts` `headers()` で `X-Robots-Tag: noindex, nofollow` を付与**。既存 server layout に安全に metadata を追加できる場合のみ補助的に `metadata.robots` を併用可、ただし **client page の server wrapper + client core 分割はしない** |
| `/account` 配下 | **noindex, nofollow** (個人情報) | 同上 (header 基本、client page 分割しない) |
| `/auth` 配下 | **noindex, nofollow, noarchive** (ログイン画面、SEO 集客対象外) | **`next.config.ts` `headers()` で `X-Robots-Tag: noindex, nofollow, noarchive` のみ**。`/auth/page.tsx` の server wrapper + client core 分割は **Plan B では行わない** (Plan A で game/next 引き継ぎを修正したばかりで SEO 目的の構造変更リスクを取らないため) |
| `/api` 配下 | **noindex** (`X-Robots-Tag` のみ、`Content-Type` が `application/json` 等で metadata 適用外) | `next.config.ts` の `headers()` で `/api/:path*` に付与 |
| `/share/[id]` | **noindex, follow** | page.tsx の `generateMetadata` で `robots: { index: false, follow: true }` を追加 (RD-B5 確定) |
| `/dm/*`, `/pokepoke/*` 配下 | **Plan B 対象外 (per-page metadata なし)、ただし index 抑止 header は付与** (Codex 第 3 回 / RD-B9 確定) | per-page metadata 整備なし / sitemap 不掲載 / アプリ内部 page の server wrapper + client core 分割なし。現状の `dm/layout.tsx` / `pokepoke/layout.tsx` の title.default = trackerName を維持。**`next.config.ts` の `headers()` に `/dm/:path*` と `/pokepoke/:path*` 用の `X-Robots-Tag: noindex, nofollow` entry を追加**して index 抑止する (現状の `src/app/robots.ts` の Disallow は `/admin /account /api /auth` のみで `/dm` `/pokepoke` を含まないため、middleware の認証 redirect 単独では検索エンジン到達を防げない事実を反映、RD-B9)。本格的な per-page SEO 整備は Phase 2 以降の別 issue (RD-B2) |
| `/privacy`, `/terms`, `/contact` | **index, follow** + 固有 metadata | server wrapper + client core 化して `metadata: { title, description, alternates: { canonical } }` を export (RD-B2 の公開ページ整備対象) |
| ルート `/` | **index, follow** + 固有 metadata | Plan B-4 で SSR ランディング化 (RD-B6 確定) |

`/share/[id]` を noindex にする理由:

- 個人ユーザーが意図せず作った戦績共有が検索結果に晒されるのは UX/プライバシー観点で好ましくない。
- SNS シェア (X / Discord) では OG プレビューは出るが、Google 検索結果には出ない、という挙動が一般的な期待値。
- `noindex, follow` を選ぶ理由: page 内の他リンク (例えば `/dm/home` への戻り) はクロール可能にしたいため。

##### B-3-b: noindex の実装層選択 (Codex 第 2 回反映で確定、二重実装を強制しない)

二重実装を全対象に強制せず、**対象ごとに最適な実装層を選択**する。原則は以下:

| 対象カテゴリ | 採用する実装層 | 理由 |
|---|---|---|
| 公開ページで server 側に metadata を自然に追加できるもの (`/share/[id]`) | **metadata `robots`** (page.tsx の `generateMetadata`) | 既に server component で metadata を出力済の経路に `robots` フィールド追加するだけで完結。client page 分割不要 |
| sensitive / app-internal page (`/auth`, `/admin`, `/account`) | **`next.config.ts` `headers()` の `X-Robots-Tag`** のみ | client page を server wrapper + client core に分割するリスク (特に `/auth` は Plan A で game/next 引き継ぎ修正済) を回避。header 1 行で完結 |
| 公開法務ページ (`/terms`, `/privacy`, `/contact`) | **server wrapper + client core 化して metadata** (RD-B2 で確定) | index 対象の公開ページで title/description/canonical を SSR HTML に出すため。`robots` フィールドは不要 (default index) |
| API path (`/api/*`) | **`X-Robots-Tag` header のみ** | `Content-Type: application/json` 等で `<meta>` タグが解釈されないため header 必須 |
| dev preview 全体 (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) | **host 固定の `X-Robots-Tag` header** (RD-B1) | 全 path 横断で本番と分離 |

**判断指針**:

- 既に server component の page (例: `/share/[id]`) に metadata を追加するのは低コスト → metadata を採用。
- client page (`"use client"` directive 付き) に metadata を入れるには server wrapper 化が必須 → そのコストを払う価値があるのは **公開法務ページ (`/terms` / `/privacy` / `/contact`) のみ** (RD-B2)。それ以外の client page (`/auth`, `/admin`, `/account`) は header だけで noindex を実現する。
- metadata と header の **両方を入れる二重実装は不要**。一貫した方針が立てば 1 層で十分。
- ただし、既に server layout が存在し、その server layout に安全に `metadata.robots` を追加できる場合 (将来 server layout が新設された時のみ該当、現状の codebase では `src/app/admin/layout.tsx` は `"use client"` の client component、`src/app/account/layout.tsx` / `src/app/auth/layout.tsx` は存在しないため、本 plan B 実装範囲ではこの条件を満たすケースは存在しない) は補助的に併用可。**client page 分割は禁止**。

##### B-3-c: dev preview の全体 noindex

dev preview (`*.workers.dev`) は検索エンジンに index されると本番と重複コンテンツになる。

修正方針 (RD-B1 で確定済、本セクションは RD-B1 を一次正とする):

- `next.config.ts` の `headers()` に **dev preview host 固定値 `dev-duepure-tracker.jianrenzhongtian7.workers.dev` 限定** の entry を追加し、`X-Robots-Tag: noindex, nofollow, noarchive` (3 値) を付与する。
- `has: [{ type: "host", value: "dev-duepure-tracker.jianrenzhongtian7.workers.dev" }]` を使い、本番 `tierlog.app` や他 `*.workers.dev` への誤発火を排除する。
- `middleware.ts` は触らない (CLAUDE.md 「auth/middleware 不変ルール」整合)。Custom Worker entry (`src/sentry-worker.ts`) も触らない (Sentry withSentry 衝突回避、B-1 / B-2 との多層化を避けるため)。
- 棄却した代替案: (a) middleware に response header 追加 = CLAUDE.md 解釈リスク、(b) Custom Worker entry で wrap = Sentry wrap 衝突可能性、(c) `*.workers.dev` の substring/regex 判定 = 本番が同 subdomain を持つ別 worker.dev URL を持つ場合に誤発火する保守性リスク。詳細は `## Resolved Decisions > ### RD-B1`。

##### B-3-d: 公開ページの固有 metadata 整備 (RD-B2 + Codex 第 2 回で確定、ハイブリッド方針)

**Plan B では「index 対象の公開法務ページ」だけを server wrapper + client core 化して metadata を整備し、それ以外の client page は触らない**。

修正方針 (per-page で実装層を分岐、Codex 第 2 回反映):

- **`/`** (root): Plan B-4 で SSR ランディング化 (server component 新規作成)、`metadata` 完備 (B-4-d 参照)。
- **`/terms`**: server wrapper + client core 化。server 側で `export const metadata: Metadata = { title: "利用規約", description: "Tierlog の利用規約を掲載しています。", alternates: { canonical: "/terms" } }`。
- **`/privacy`**: 同様、`title: "プライバシーポリシー"`、`description` / `alternates: { canonical: "/privacy" }`。
- **`/contact`**: 同様、`title: "お問い合わせ"`、`description` / `alternates: { canonical: "/contact" }`。
- **`/share/[id]`**: Plan A の `generateMetadata` は server component で既に動作しており title/description/og:image/twitter を完備。本 plan で追加するのは B-3-e の `robots: { index: false, follow: true }` のみ (RD-B5)。
- **`/auth`**: `next.config.ts` の `X-Robots-Tag: noindex, nofollow, noarchive` header **のみ** で対応 (Codex 第 2 回確定)。`/auth/page.tsx` の server wrapper + client core 分割は **Plan B では行わない**。理由: Plan A で game/next 引き継ぎ + open redirect helper + email/password 経路の resolvedTarget 共有を修正したばかりで、SEO 目的の構造変更で regression を起こすリスクを取らない。

**アプリ内部ページ (`/dm/*` `/pokepoke/*`) の扱い (Codex 第 2 回 + 第 3 回で確定)**:

- **Plan B 対象外 (per-page metadata 整備 / sitemap 掲載 / server wrapper + client core 分割は実施しない)**。
- 現状 `dm/layout.tsx` / `pokepoke/layout.tsx` の `title.default = ${trackerName}` がすべての sub page に適用される状態を **そのまま維持**。
- **`next.config.ts` の `headers()` に `/dm/:path*` と `/pokepoke/:path*` 用の `X-Robots-Tag: noindex, nofollow` entry を追加**して index 抑止する (Codex 第 3 回確定、RD-B9)。
  - 理由: 現状の `src/app/robots.ts` の Disallow は `/admin /account /api /auth` のみで `/dm` `/pokepoke` を含まないため、middleware の認証 redirect 単独では「外部リンク経由で Googlebot が `/dm/home` の認証 redirect 前 HTML を一瞬触れる」可能性を排除しきれない。header 追加が確実。
  - これは「アプリ内部 page の server wrapper / client core 分割なし」という RD-B2 と両立する (`next.config.ts` だけで完結、client page は触らない)。
- 本格的な per-page SEO 整備 (title / canonical / OGP の精緻化) は Phase 2 以降の別 issue で検討。

**`/admin` `/account` の扱い (Codex 第 2 回で確定)**:

- client page を **server wrapper + client core に分割しない**。
- noindex は **`next.config.ts` `headers()` の `X-Robots-Tag: noindex, nofollow` を基本**とする。
- 既存 server layout が存在し、安全に `metadata.robots` を追加できる場合のみ補助的に併用可 (注: 現状の codebase では `src/app/admin/layout.tsx` は client component、`src/app/account/layout.tsx` / `src/app/auth/layout.tsx` は不在のため、本 plan B では実質的に `X-Robots-Tag` header only 経路のみ採用となる。将来 server layout を新設した時に再評価)。**client page (`page.tsx` の `"use client"`) を分割するのは禁止**。

**server wrapper + client core パターンの適用範囲 (Codex 第 2 回で確定)**:

- 対象: **公開法務 3 page (`/terms`, `/privacy`, `/contact`) のみ**。
- 構造: `src/app/<path>/page.tsx` を server component (`metadata` export) に変更し、既存の client ロジックを `src/app/<path>/<Name>Client.tsx` に切り出して `import` する。
- client core (`*Client.tsx`) には `"use client"` directive を残し、既存の `useEffect` / `useState` / `useRouter` ロジックを **ファイル移動のみで再実装しない**。
- `/auth` / `/admin` / `/account` / `/dm/*` / `/pokepoke/*` は **対象外**。

##### B-3-e: `/share/[id]` の noindex 追加

Plan A 完了時点で `share/[id]/page.tsx` の `generateMetadata` は title/description/og:image を生成済。**`robots: { index: false, follow: true }` を追加** する。

```ts
return {
  title: ...,
  description: ...,
  openGraph: { ... },
  twitter: { ... },
  robots: { index: false, follow: true },  // 追加
};
```

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| `/admin` の noindex (header only、Codex 第 2 回確定) | `curl -I https://...workers.dev/admin` | `X-Robots-Tag: noindex, nofollow` を含む。`<meta name="robots">` は補助的に出ても可だが必須ではない |
| `/account` の noindex (header only) | `curl -I https://...workers.dev/account` | 同上 |
| `/auth` の noindex (header only、Codex 第 2 回確定) | `curl -I https://...workers.dev/auth` | `X-Robots-Tag: noindex, nofollow, noarchive` を含む。**`<meta>` 経由の出力は不要** (page.tsx は触らない) |
| `/api/og/<id>` の noindex (header) | `curl -I https://...workers.dev/api/og/<id>` | `X-Robots-Tag: noindex` を含む |
| `/share/<id>` の noindex (metadata) | `curl -sL` で取得して `<meta name="robots"` 確認 | `noindex, follow` 形式 (Plan A の `generateMetadata` 拡張、RD-B5) |
| dev preview 全体 noindex (RD-B1 確定) | dev preview (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) の任意 path に `curl -I` | `X-Robots-Tag: noindex, nofollow, noarchive` を全 path で含む |
| 本番 (`tierlog.app`) は noindex が **付かない** こと (RD-B1 検証必須) | `curl -I https://tierlog.app/dm/home` | dev preview noindex header (RD-B1) が **付かない** (default index)。ただし `/admin` `/account` `/api` 等の per-path noindex は本番でも付くので、検証対象は dev preview noindex 専用ヘッダの有無 |
| 公開法務ページの固有 title/description/canonical (RD-B2 反映) | `/terms`, `/privacy`, `/contact` に curl して metadata 確認 | 各 page 固有の `<title>` / `<meta name="description">` / `<link rel="canonical">` が SSR HTML に出力される |
| ルート (`/`) の SSR ランディング metadata (RD-B6) | `curl -sL https://...workers.dev/` | 固有 `<title>` / `<meta name="description">` / `og:image` / `<link rel="canonical" href="/">` が SSR HTML に出力される |
| アプリ内部 page (regression なし、Codex 第 2 回確定) | `/dm/home`, `/pokepoke/home` 等を curl して `<title>` 確認 | 現状 (layout default の trackerName) のまま、Plan B で変更なし |
| `/auth` の構造変更なし (Codex 第 2 回確定) | `git diff src/app/auth/page.tsx` (実装後) | Plan A 完了時点と差分なし、Plan B では触らない |

#### リスク / rollback

- **リスク 1 (RD-B1 で軽減済)**: dev preview noindex の host 判定誤発火 → RD-B1 で固定値 `dev-duepure-tracker.jianrenzhongtian7.workers.dev` のみに限定済。本番 / 他 worker.dev への誤発火なし。
- **リスク 2 (RD-B2 + Codex 第 2 回でさらに軽減済)**: per-page metadata 大規模リファクタによる既存挙動の破壊 → Codex 第 2 回で対象を **公開法務 3 page (`/terms`, `/privacy`, `/contact`) のみ** に絞り込み済。`/auth` `/admin` `/account` は header only で client page 分割なし。`/dm/*` `/pokepoke/*` の 12 page は **client page / per-page metadata / sitemap 掲載は対象外** (ただし index 抑止 header は RD-B9 で実施)。regression リスク最小。
- **リスク 3**: `/share/[id]` の noindex 追加で既に Google にインデックス済の share URL があった場合、削除される可能性。Plan A 完了直後の段階では一般公開していないため索引データはほぼ無いはず (確認は実装チャットで Google Search Console を見る、ただし dashboard 操作は実装チャット側で実施)。
- **リスク 4**: server wrapper + client core 化対象の **3 page (`/terms`, `/privacy`, `/contact`)** で client core 移動時の import path / props 受け渡しのミス。**client ロジックは再実装せずファイル移動のみ**で対応すれば挙動変化なし。`/auth` は分割しないため本リスクの対象外 (Plan A の game/next 引き継ぎ修正に対する regression リスクを取らない、Codex 第 2 回確定)。
- **rollback**: `git revert` で各 page と `next.config.ts` を Plan A 完了時点に戻す。`middleware.ts` / `src/sentry-worker.ts` / `auth/page.tsx` / `dm/*` / `pokepoke/*` / `admin/*` / `account/*` は本 plan で **触らない** ため rollback 不要。検索エンジン側の index 状態は revert 後数日〜数週間かけて元に戻る。

#### Plan A との依存関係

- Plan A の `generateMetadata` (`share/[id]/page.tsx`) を **拡張する**形 (`robots` 追加)。既存 title/description/og:image は維持。
- Plan A の `loading.tsx` / `global-error.tsx` には noindex を入れない (fallback 画面なので検索対象外)。

---

### B-4: 公開ランディング + sitemap 整理 (P1)

#### 背景 / 解決したい穴

統合 audit §4.7:

- root が Cookie 依存の `permanentRedirect` で、未ログインユーザーが直接 `tierlog.app` を訪問しても **意味のあるコンテンツがゼロ**。SEO/AdSense 審査で「Insufficient original content」リスク高。
- sitemap (`src/app/sitemap.ts`) が `/${slug}/home` (ログイン必須) を主要 URL として登録している → Google クローラーがログイン画面に到達し SEO 評価低下。

#### 対象ファイル候補

- `src/app/page.tsx` (root、Cookie 依存 `permanentRedirect` を変更判断)
- `src/app/sitemap.ts` (掲載 URL の整理)
- 新規 `src/app/(public)/page.tsx` または `src/app/landing/page.tsx` (公開ランディング、判断)
- `src/components/landing/*` (ランディング UI 部品、新規)
- **`src/components/providers/BanGuard.tsx`** (Codex 第 3 回追加: root `/` を公開除外する最小修正、後述 B-4-e 参照)

#### 実装方針

##### B-4-a: ルート (`/`) の公開ランディング化

二案あり、どちらかを実装時判断:

- **案 (i) 最小ランディング**: root を SSR で **未ログインでも見える簡易ページ**にする (ヒーローセクション + 「これは何のアプリか」+ 「無料で始める / ログイン」ボタン + スクリーンショット 2-3 枚)。ログイン済の場合は cookie を見て `/${game}/home` に redirect する分岐を残す。
- **案 (ii) スプリッタ**: root は `<UnauthGate />` のような component を返し、内部で `useSession()` (既存 client.ts) で判定して未ログインなら landing component を描画、ログイン済なら従来通り `/${game}/home` に router.replace。

**判断**: **案 (i) を推奨**。理由:

- SEO/AdSense 審査で重要なのは「**SSR HTML に意味のあるコンテンツが入っていること**」。案 (i) の SSR ランディングなら Google bot に内容が届く。
- 案 (ii) は client-side rendering なので SSR HTML はスケルトンのみ → 審査リスクが残る。
- 既存ログイン済ユーザーへの影響: 案 (i) は SSR で cookie を読んで「ログイン済なら `/${game}/home` に redirect」する分岐を入れれば従来挙動を維持できる。

実装パターン (擬似コード):

```tsx
// src/app/page.tsx (server component)
import { cookies } from "next/headers";
import { permanentRedirect } from "next/navigation";
import { isGameSlug, DEFAULT_GAME } from "@/lib/games";
import { LandingHero } from "@/components/landing/LandingHero";

export default async function Home() {
  const cookieStore = await cookies();
  const saved = cookieStore.get("selectedGame")?.value;
  // ログイン判定は cookie だけでは確実でないため、まず SSR ランディングを出す。
  // 「アプリを開く」ボタンが /${game}/home へ遷移し、BanGuard で未認証なら /auth へ。
  const defaultGame = isGameSlug(saved) ? saved : DEFAULT_GAME;
  return <LandingHero defaultGame={defaultGame} />;
}
```

**注**: 既存挙動 (cookie で game 判定して `/${game}/home` に直接 redirect) は撤廃する。代わりに SSR ランディング + 「アプリを開く」ボタンで `/${defaultGame}/home` に遷移する形にする。ログイン済ユーザーの体験は 1 クリック増えるが、SEO 効果を優先する。

##### B-4-b: ランディングコンテンツの設計

- **ヒーローセクション**: 「Tierlog — デュエプレ・ポケポケの対戦記録と環境分析」見出し + サブテキスト + 「アプリを開く」CTA。
- **特徴セクション** (3-4 個): 戦績記録の簡単さ / 環境統計の可視化 / Discord チーム機能 / X / Google ログイン対応。
- **対応ゲーム**: ロゴ + ゲーム名 (デュエル・マスターズ プレイス / ポケモンカードゲーム ポケット)。
- **フッター**: プライバシー / 利用規約 / お問い合わせへのリンク。
- 全 SSR (`"use client"` 不要)。`metadata` で title/description/canonical/og:image を設定。
- スクリーンショット: 新規撮影必要。**素材の準備は実装チャット側で別途依頼**。Plan B では「placeholder 画像を入れて構造を作る」までを scope に。

##### B-4-c: sitemap 整理

現状の sitemap.ts は `/${slug}/home` (ログイン必須) と `/privacy`, `/terms` のみ。

修正方針:

- **`/${slug}/home` (ログイン必須) を sitemap から削除**。Google クローラーがログイン画面に到達するのを避ける。
- **`/` (新ランディング)** を追加。priority 1.0、changeFrequency: weekly。
- **`/privacy`, `/terms`, `/contact`** は維持。
- 将来 (Phase 3) で blog / changelog などの公開コンテンツを追加したら、sitemap も拡張。
- **`/share/[id]` は sitemap に入れない** (個別 share は動的生成で数が膨大、かつ B-3 で noindex 設定)。

実装パターン:

```ts
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1.0 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.5 },
  ];
}
```

##### B-4-d: ランディング page の metadata

```ts
export const metadata: Metadata = {
  title: "Tierlog — デュエプレ・ポケポケの対戦記録と環境分析",
  description: "デュエル・マスターズ プレイスとポケモンカードゲーム ポケットの対戦記録、環境統計、デッキ管理を 1 つのアプリで。X / Google ログインで無料で始められます。",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Tierlog",
    description: "デュエプレ・ポケポケの対戦記録と環境分析",
    images: [{ url: "/og-default.png", width: 1200, height: 630 }],
    type: "website",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tierlog",
    description: "デュエプレ・ポケポケの対戦記録と環境分析",
    images: ["/og-default.png"],
  },
  robots: { index: true, follow: true },
};
```

`og-default.png` は B-2-c で追加するファイルと共用 (1 ファイル 2 用途)。

##### B-4-e: BanGuard で root `/` を公開除外する最小修正 (Codex 第 3 回追加、RD-B8 で確定)

B-4-a で root を SSR 公開ランディング化しても、現状 `src/components/providers/BanGuard.tsx` の `EXCLUDED_PATHS = ["/auth", "/terms", "/privacy", "/contact", "/share"]` に `/` が含まれていない。`pathname.startsWith(p)` で除外判定するため、root `/` は **client hydration 後に BanGuard が `/auth` へ強制 redirect** する挙動になっており、SSR で公開ランディングが描画されても直後に消える。

修正方針 (最小差分):

- `EXCLUDED_PATHS` に **単純に `"/"` を追加すると `pathname.startsWith("/")` で全 path が bypass されて BanGuard が全停止** する → **禁止**。
- 代わりに **除外判定ロジックを「exact match (root) + prefix match (`/auth` 等)」の二段判定に変更** する。実装パターン (擬似コード):
  ```ts
  // 旧:
  // const EXCLUDED_PATHS = ["/auth", "/terms", "/privacy", "/contact", "/share"];
  // const isExcluded = EXCLUDED_PATHS.some(p => pathname.startsWith(p));

  // 新 (RD-B8):
  const EXACT_PUBLIC_PATHS = ["/"]; // root ランディングのみ exact match
  const PUBLIC_PREFIXES = ["/auth", "/terms", "/privacy", "/contact", "/share"]; // 既存 EXCLUDED_PATHS 同等
  const isExcluded =
    EXACT_PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  ```
- これにより:
  - `/` (root ランディング) は exact match で公開除外 → 未ログインユーザーが滞在可能。
  - `/dm/home` は `EXACT_PUBLIC_PATHS` にも `PUBLIC_PREFIXES` にも該当しないため従来通り BanGuard が認証 redirect。
  - `/auth/callback` は `PUBLIC_PREFIXES` の `/auth` + `/` で `pathname.startsWith("/auth/")` がマッチ → 従来通り bypass (既存挙動と同じ)。
- **Plan A の BanGuard 再実装ではない**。Plan A で確立した retry + fail-open + anonymous redirect + stage===4 BAN 画面の各ロジックは **そのまま維持**、`EXCLUDED_PATHS` の判定ロジックのみ拡張する最小差分。

検証 (B-4 検証セクションに追加、RD-B8):

- 未ログインで `/` にアクセス → SSR ランディングが表示され、hydration 後も維持される (BanGuard が `/auth` へ強制 redirect しない)。
- 未ログインで `/dm/home` にアクセス → 従来通り `/auth` に誘導される (regression なし)。
- ログイン済 + 非 BAN ユーザーで `/` にアクセス → ランディングが見え、「アプリを開く」CTA から `/${game}/home` へ遷移可能。
- BAN ユーザー (`stage === 4`) で `/` にアクセス → exact match で除外されるため、root では BAN 画面ではなくランディングが見える。**判断**: BAN ユーザーがランディングを閲覧できることは UX 影響ゼロ (重要操作は `/dm/*` `/pokepoke/*` 配下にあり、そこでは従来通り BAN 画面が出る)。RD-B8 で許容する。

#### 検証方法

| 確認項目 | 手順 | 期待結果 |
|---|---|---|
| root SSR コンテンツ | `curl -sL https://...workers.dev/ \| grep -E '<h1\|<meta name=\"description\"'` | h1 にランディング見出し、description にサービス説明 |
| **未ログインで `/` ランディングが維持される** (Codex 第 3 回追加、RD-B8) | dev preview で Cookie/localStorage を空にして `/` を訪問、ブラウザ実機で hydration 後も画面が維持されることを確認 | SSR ランディングが描画され、BanGuard hydration 後も `/auth` redirect されず滞在可能 |
| **未ログインで `/dm/home` が `/auth` 誘導される** (regression なし確認、RD-B8) | dev preview で Cookie/localStorage を空にして `/dm/home` を訪問 | 従来通り BanGuard が `/auth` へ redirect (BanGuard exact + prefix 判定が root だけを除外、他は従来通り) |
| ログイン済ユーザーの挙動 | dev preview でログイン済 cookie 状態で root を訪問 | ランディングが見える (1 クリックで `/${game}/home` へ移動可能) |
| sitemap 内容 | `curl https://...workers.dev/sitemap.xml` | `/`, `/privacy`, `/terms`, `/contact` のみ |
| robots.txt | `curl https://...workers.dev/robots.txt` | `Disallow: /admin /account /api /auth` を維持 (Plan A 完了時点と同じ) |
| Google Search Console での確認 | (本番反映後、実装チャット側で実施) | クロール対象 URL が変更されている |

#### リスク / rollback

- **リスク 1**: 既存ログイン済ユーザーの体験が変わる (root が `/${game}/home` に直接 redirect → ランディング表示 + 1 クリック)。改善案として **cookie に "skip_landing" flag を持たせる** か、**ヘッダに「アプリへ」ボタンを大きく出す** で軽減。判断は実装チャットで UX レビュー。
- **リスク 2**: ランディングのデザイン質が低いと逆に「素人作」と思われ AdSense 審査に不利。最低限のクオリティ (Tailwind で整える) を実装時に確保する。
- **リスク 3**: sitemap から `/${slug}/home` を削除すると、既に Google に index されていた場合に削除される。Plan A 完了時点では一般公開していないため索引はほぼ無いはず。
- **rollback**: `git revert` で `src/app/page.tsx` と `src/app/sitemap.ts` を Plan A 完了時点に戻す。`src/components/landing/` を削除。

#### Plan A との依存関係

- Plan A の root `page.tsx` の `permanentRedirect` は **変更対象**。Plan A 完了時点では cookie 依存 redirect だったが、Plan B で SSR ランディングに変更。
- Plan A の `/share/[id]/page.tsx` の `generateMetadata` は B-3-e で `robots` 追加するが、その他は維持。

---

### B-5: Cloudflare Web Analytics / Sentry / Logs の責任分界明文化 (P2)

#### 背景 / 解決したい穴

公開後の運用で「何をどこで見るか」が曖昧:

- **Cloudflare Web Analytics**: cookieless ページビュー / 国別 / device 別。プライバシー安全。
- **Sentry**: サーバー側 (Cloudflare Workers) のエラーと stack trace。Plan A 完了時点で client 側 Sentry は導入しない方針 (`src/sentry-worker.ts` コメント記載済)。
- **Cloudflare Workers Logs Engine**: console.log / console.error の集約。Plan A 完了時点で client 側エラーはここに飛ぶ想定。
- **Supabase Dashboard**: DB クエリ、auth logs、Storage 利用状況。

これらの「どんなエラーをどこで見るか」を `docs/runbooks/` に明文化しないと、本番運用時に「Sentry にイベント来ない、なぜ?」「console.error が見えない、なぜ?」で時間を浪費する。

#### 対象ファイル候補

- `docs/runbooks/sentry-runbook.md` (本 plan で新規作成、`docs/reports/2026-05-25_sentry_runbook_implementation.md` の実装報告を runbook 化)
- 新規 `docs/runbooks/observability-overview.md` (各層の役割と確認手順)
- `CLAUDE.md` / `AGENTS.md` の関連セクション更新 (運用ルール明示)

#### 実装方針

##### B-5-a: 責任分界表の作成

`docs/runbooks/observability-overview.md` に以下の表を含める:

| 観測対象 | 観測層 | 確認場所 | 保持期間 | アクセス権 |
|---|---|---|---|---|
| Cloudflare Workers の例外 | Sentry | Sentry Dashboard | 30 日 (Free) | Admin |
| Cloudflare Workers の console.log | Cloudflare Logs Engine | Cloudflare Dashboard → Workers → Logs | 1 日 (Free) | Admin |
| ユーザーのページビュー / 国別 | Cloudflare Web Analytics | Cloudflare Dashboard → Web Analytics | 6 月 | Admin |
| Supabase の DB 例外 | Supabase Logs | Supabase Dashboard → Logs | 1 日 (Free) | Admin |
| Supabase Auth のログイン履歴 | Supabase Logs | Supabase Dashboard → Auth → Users | 7 日 | Admin |
| client 側 (ブラウザ) の console.error | **観測なし** (本 plan スコープ外) | (将来 client Sentry 導入時に拡張) | — | — |
| 不正な共有作成試行 | Sentry (API route で `Sentry.captureMessage`) | Sentry Dashboard | 同上 | Admin |

##### B-5-b: 各層へのイベント送信ガイド

「どんな状況でどこに送るか」を明示:

- **Sentry に送る**: HTTP 5xx 発生、認可エラー、想定外例外、`Sentry.captureException` 呼び出し時、`beforeSend` で機微情報 scrub 済。
- **console.log に書く** (= Cloudflare Logs Engine 経由): 非エラーの運用情報 (cron 起動、内部 API 呼び出しのトレース)、debug 情報。Sentry に送るほどではない。
- **Cloudflare Web Analytics**: 自動収集 (beacon.min.js)。手動操作なし。
- **Supabase Logs**: DB 側の自動収集。SQL クエリの監査が必要なら Supabase Dashboard で確認。

##### B-5-c: sentry-runbook.md の新規作成

- `docs/runbooks/sentry-runbook.md` を新規作成し、Plan B-1 で実装した `beforeSend` / `release` / `environment` を運用手順として明文化する (実装報告 `docs/reports/2026-05-25_sentry_runbook_implementation.md` を一次情報として参照)。
- 「Sentry にイベントが来ない場合のトラブルシュート」セクションを含める (DSN 確認 / Runtime variable 確認 / Sentry rate limit 確認)。

##### B-5-d: AGENTS.md / CLAUDE.md の関連セクション更新判断

- 現状 AGENTS.md / CLAUDE.md には「Sentry」の節がない。Plan B-5 で **追加するかは実装チャット判断**。最小限の言及 (`docs/runbooks/observability-overview.md` を参照、と書く程度) で十分。
- 過剰に膨らませず、runbook 側を一次正にする。

#### 検証方法

- 文書整備のみ。技術的な検証は不要。
- `docs/runbooks/observability-overview.md` を作成後、目視レビュー (実装チャット内で Claude 自身が確認)。
- Plan B-1 で実装した Sentry scrubber が動作することは B-1 検証で確認済。本 sub-task は文書化のみ。

#### リスク / rollback

- リスクほぼなし (文書のみ)。
- rollback: `git revert` で `docs/runbooks/observability-overview.md` と `docs/runbooks/sentry-runbook.md` を削除する (両方とも本 plan で新規作成)。

#### Plan A との依存関係

- なし (文書のみ、コード非依存)。

---

### B-6: 法務・公開導線の現状確認と不足項目リストアップ (P2、実装は別 plan)

#### 背景 / 解決したい穴

統合 audit §5.2 (Ads / Privacy / Legal) で「現状の `terms` / `privacy` / `contact` の不足項目」が指摘されている。広告掲載 (AdSense) / サブスク導入 (Stripe) の審査時に問題になり得る要素がある:

- `terms/page.tsx` の商用目的禁止条文 (運営者の広告掲載 / サブスク提供と、利用者の商用利用禁止を明確に分けたい)
- `privacy/page.tsx` に決済情報の取得記載なし
- 特定商取引法に基づく表記がない (有料サービス導入時に必須)
- 広告タグの consent UI なし (将来 GDPR/CCPA 対応が必要な地域での販売時に必須、日本国内のみなら短期的には不要)
- ads.txt なし (AdSense 申請時に必要、ただし審査前は不要、審査通過後に追加)

#### スコープ

**Plan B-6 では「現状確認 + 不足項目のリストアップ」までで実装は行わない**。実際の文言追加、特商法ページ追加、consent UI 実装などは **Phase 3 法務 plan** で扱う。

#### 対象ファイル候補

- 確認のみ:
  - `src/app/terms/page.tsx`
  - `src/app/privacy/page.tsx`
  - `src/app/contact/page.tsx`
- 新規追加: `docs/reports/2026-05-27_legal_gap_analysis.md` (現状と Phase 3 で必要な項目の差分レポート)

#### 実装方針

##### B-6-a: 既存法務ページの内容確認

- `terms/page.tsx` の全条文を確認。商用目的禁止条文の解釈を整理 (運営者 vs 利用者の区別)。
- `privacy/page.tsx` の取得情報項目、第三者提供、Cookie 利用、Cloudflare Web Analytics の言及、Supabase 経由のデータ保管などを確認。
- `contact/page.tsx` の連絡手段 (メール / フォーム) を確認。

##### B-6-b: 不足項目のリストアップ

`docs/reports/2026-05-27_legal_gap_analysis.md` に以下を整理:

- **AdSense 審査前に必要な項目**:
  - プライバシーポリシーの第三者広告利用記載 (まだ広告なしなので追加不要、AdSense 通過後に対応)
  - 運営者情報 (個人運営の場合、開示請求方式で対応可能、経産省ガイドライン参照)
  - 連絡先 (`/contact` ページ既存、現状で十分か確認)
- **サブスク導入前に必要な項目**:
  - 特定商取引法に基づく表記ページ (`/specified-commercial-transactions` 新規)
  - 利用規約への有料プラン条項 (自動更新、解約、返金)
  - プライバシーポリシーへの決済情報取得記載
- **将来 GDPR/CCPA 対応で必要な項目** (海外展開時のみ):
  - consent UI (Cookie / トラッキング同意)
  - データポータビリティ請求対応

##### B-6-c: 商用目的禁止条文の解釈整理

- `terms/page.tsx` の現条文を **逐語的に確認** し、運営者の広告掲載 / サブスク提供が許容されるか整理。
- Plan A 完了時点で「商用目的禁止」条文は (運営者の事前の同意がある場合を除く) と書かれており、運営者収益化は文言上排除されていない。
- ただし「明示的に許容される条文への改訂」が将来必要。Phase 3 で対応。

#### 検証方法

- `docs/reports/2026-05-27_legal_gap_analysis.md` を実装チャットが作成。
- 内容のレビュー (実装チャット内で Claude 自身が確認、もしくは Codex に再レビュー依頼)。

#### リスク / rollback

- リスクほぼなし (文書のみ)。
- rollback: `git revert` で `docs/reports/2026-05-27_legal_gap_analysis.md` 削除。

#### Plan A との依存関係

- なし。Plan A で `terms/page.tsx` の条文に変更はない (Plan B-6 で確認のみ、変更は Phase 3)。

---

## 4. 実装順序 (推奨)

依存関係とリスクから次の順序を推奨:

1. **B-1** (Sentry scrubber / release / environment)
   - 単一ファイル (`src/sentry-worker.ts`) 中心、DB 変更なし、最小リスク。
   - 公開前 PII 漏洩リスクを即時解消するため最優先。
   - 完了時間目安: **半日**。

2. **B-3** (noindex / 公開ページ metadata / dev preview index 防止)
   - **RD-B2 + Codex 第 2 回反映でさらに規模縮小**:
     - **server wrapper + client core 分割対象は公開法務 3 page (`/terms` / `/privacy` / `/contact`) のみ** (`/auth` は header only に変更)。
     - `/auth` / `/admin` / `/account` / `/api/*` は `next.config.ts` `X-Robots-Tag` header だけで noindex 付与、**client page 分割なし**。
     - `/share/[id]` は既存 `generateMetadata` に `robots` フィールド追加のみ。
     - `next.config.ts` headers() に RD-B1 確定の dev preview noindex 行 + per-path noindex 行を追加。
   - `/dm/*` `/pokepoke/*` の 12 page は **完全に触らない** (Plan B 対象外、Phase 2 以降の別 issue)。
   - dev preview 段階で本番想定 indexing 制御を入れたい (Plan B-4 のランディング作成前に noindex を確実に設定)。
   - 完了時間目安: **0.5 日** (server wrapper 化が 3 page のみで `/auth` 分減のため、Codex 第 2 回で更に短縮)。

3. **B-2** (OG ルートのフォント自前 + cache/error fallback)
   - 単一 route (`/api/og/[id]/route.tsx`) + helper、フォントファイル追加。
   - SNS バズ時の安定性に直結、公開前に対応したい。
   - 完了時間目安: **1 日**。

4. **B-4** (公開ランディング + sitemap 整理)
   - root の SSR ランディング作成、規模感が中。スクリーンショット素材依頼が並行発生。
   - SEO/AdSense 審査の最大ブロッカー、ただし公開後でも対応可能 (Plan B 完了の最終仕上げ)。
   - 完了時間目安: **2〜3 日**。

5. **B-5** (CW Analytics / Sentry / Logs 責任分界明文化)
   - 文書整備のみ、コード変更なし。B-1 と並行可能。
   - 完了時間目安: **0.5 日**。

6. **B-6** (法務・公開導線の現状確認)
   - 文書整備のみ、Phase 3 への準備。
   - 完了時間目安: **0.5 日**。

**並行実行**: B-1 と B-5 は並行可能 (B-1 の実装結果を B-5 が文書化する関係なので B-1 → B-5 の順が無難)。B-2, B-3, B-4 は順次。B-6 は B-1〜B-5 と完全独立、いつでも可。

各サブタスクは **別 PR** または「B-1 + B-5」「B-2 単独」「B-3 単独」「B-4 単独」「B-6 単独」の計 5 PR を推奨。

---

## 5. DB migration の判断ポイント

**Plan B は DB 変更を含まない**。すべて code-only または文書のみ。staging/production への migration 適用作業は不要。

ただし B-1 で **Cloudflare ダッシュボードの Variables and Secrets (Runtime) への `SENTRY_DSN` / `NEXT_PUBLIC_SUPABASE_ENV` 確認** と、**Version Metadata Binding 設定** が必要。これは外部サービス操作のため **本 plan 作成チャットでは実施しない**、実装チャット側で公式ドキュメント (WebFetch) 確認後に手順を runbook 化してユーザーに案内 → ユーザー操作。

---

## 6. 統合検証 (Plan B 全体)

サブタスク個別検証の他に、Plan B 全体反映後の統合検証:

| カテゴリ | 検証内容 |
|---|---|
| Observability | staging で Sentry にエラー送信、event payload に Authorization/Cookie/token/Supabase key が含まれない |
| Observability | release / environment が Sentry ダッシュボードで正しく分離されている |
| OG | dev preview の `/api/og/<existing-id>` が curl で 200 + 画像 binary を返す |
| OG | フォント取得失敗時の fallback が動作する (mock 検証) |
| OG | 想定外例外時の `og-default.png` redirect が動作する (mock 検証) |
| OG | Workers Cache が 2 回目で hit する |
| SEO | dev preview 全 path が `X-Robots-Tag: noindex, nofollow, noarchive` (RD-B1 確定の固定値 host 経由) |
| SEO | 本番 `tierlog.app` で **dev preview 用 noindex ヘッダが付かない** こと (RD-B1 検証必須、per-path noindex は本番でも付く) |
| SEO | `/admin` / `/account` / `/auth` / `/api` が `X-Robots-Tag` header で noindex (Codex 第 2 回確定: header only、client page 分割なし) |
| SEO | `/share/[id]` が `<meta name="robots">` で `noindex, follow` (Plan A 既存 server `generateMetadata` 拡張、RD-B5) |
| SEO | 公開法務ページ (`/terms`, `/privacy`, `/contact`) と `/` に固有 title/description/canonical が SSR HTML に出る (RD-B2 + RD-B6 反映、server wrapper + client core 化 or 新規 server component) |
| SEO | アプリ内部 `/dm/*` `/pokepoke/*` は **現状の layout default title のまま** (Plan B 対象外、Codex 第 2 回確定、regression なし) |
| SEO | `/dm/:path*` `/pokepoke/:path*` に `X-Robots-Tag: noindex, nofollow` header が付与される (Codex 第 3 回 / RD-B9 確定。robots.txt が `/dm` `/pokepoke` を Disallow していない事実を補う) |
| SEO | `/auth/page.tsx` / `/admin/*` / `/account/*` / `/dm/*` / `/pokepoke/*` の **client page が分割されていない** こと (`git diff` で構造変更なし確認、Codex 第 2 回確定) |
| Landing | **未ログインで `/` ランディングが BanGuard hydration 後も維持される** (Codex 第 3 回 / RD-B8) |
| Landing | **未ログインで `/dm/home` は従来通り `/auth` へ redirect される** (BanGuard regression なし、RD-B8) |
| OG | Workers Cache 動作を **独自ヘッダ `X-Tierlog-OG-Cache: HIT/MISS` で検証** (RD-B10、`cf-cache-status` は別レイヤなので使わない) |
| OG | ローカル / Node 環境で `globalThis.caches` 不在時に cache layer がスキップされる (RD-B10 fallback) |
| Landing | root が SSR でランディング HTML を返す (Cookie なしで意味のあるコンテンツが見える) |
| Landing | sitemap が `/`, `/privacy`, `/terms`, `/contact` のみで `/${slug}/home` を含まない |
| 既存機能の非破壊 | Plan A 完了時点の機能 (`shares.image_url` 二段防御、auth `game/next`、BanGuard fail-open + retry、legacy URL 修正、loading/global-error) が **すべて動作** すること |

#### Claude Code が自前で実施できる検証

- `npm run lint` / `npx tsc --noEmit` / `npm test -- --run`
- `curl -sL` で SSR HTML 取得、`<meta>` / `<title>` / `og:image` / `X-Robots-Tag` 確認
- `curl -I` で response header / status code 確認
- `git grep` による Google Fonts fetch 残置 / `permanentRedirect` 残置 / `tierlog.app` ハードコード残置の検出
- `npx opennextjs-cloudflare build` で OpenNext ビルドが通ること (新規フォント binding 経由が build 時に解決できるか確認、ただし本 plan 作成チャットでは build 実行しない)

#### ユーザーのブラウザ実機確認が必要

- dev preview で Sentry の Test Event 送信 (実装チャット側で Sentry CLI または `Sentry.captureMessage` 経由)
- Cloudflare ダッシュボードでの Variables and Secrets 設定確認 (Runtime セクションに `SENTRY_DSN` / `NEXT_PUBLIC_SUPABASE_ENV` 登録、Version Metadata Binding 確認)
- Sentry Dashboard で release/environment が正しく分離されているか確認
- Google Search Console / Bing Webmaster Tools で sitemap 反映と index 状態確認 (本番反映後)
- 本番反映後、X / Discord での OGP プレビュー実機確認
- 本番反映後、AdSense 申請可能性の確認 (申請自体は別フェーズ)

---

## 7. Codex にレビューさせるべき観点

`/review-plan-loop` で plan-critic を回した後、Codex に本 plan を渡してレビュー依頼する際の観点リスト:

1. **B-1 `beforeSend` の scrub 抜け漏れ**
   - SENSITIVE_HEADERS / SENSITIVE_PARAMS の正規表現が **大文字小文字 / 部分一致 / 順序ずれ** で抜け落ちないか
   - request body の再帰 walk で循環参照 / 巨大ペイロードの取り扱いは安全か (再帰深度制限 / size cap)
   - breadcrumb (fetch / xhr) への scrub 適用網羅性
2. **B-1 release 取得経路の確実性**
   - Cloudflare Version Metadata Binding の互換性 (`nodejs_compat` + Custom Worker entry でちゃんと届くか)
   - Build variable 経由 (`WORKERS_CI_COMMIT_SHA`) が Custom Worker の `env` に届くか
   - fallback 順序の妥当性
3. **B-1 environment 判定**
   - Runtime セクション登録漏れ時の挙動 (デフォルト production フォールバック)
   - `beforeSend` 内 host fallback を RD-B1 と同じ固定値 host (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) 限定にする方針の妥当性 (広い `*.workers.dev` substring 判定は RD-B1 と同じ理由で採らない)
4. **B-2 ASSETS binding 経由のフォント取得**
   - Custom Worker entry (`src/sentry-worker.ts`) から `ASSETS` binding が `getCloudflareContext()` 経由でちゃんと取れるか
   - 同期 module-scope cache (`FONT_CACHE`) が isolate 間で誤動作しないか
   - フォント取得失敗時の fallback が ImageResponse の `fonts` 引数の空配列で動作するか (`next/og` の挙動確認)
5. **B-2 Workers Cache API**
   - `caches.default` の cache key 設計 (URL ベースで衝突なしか)
   - `ctx.waitUntil()` が Custom Worker entry から呼び出し可能か
   - cache invalidation の方針 (share 削除時のステイル cache、Plan B-2 では未対応で OK か)
6. **B-3 noindex の実装層選択の整合性** (RD-B1 / RD-B2 + Codex 第 2 回反映後)
   - 公開法務ページ (`/terms` / `/privacy` / `/contact`) は metadata、sensitive ページ (`/auth` / `/admin` / `/account` / `/api`) は `X-Robots-Tag` header、dev preview 全体は host 固定 header、という per-対象の実装層選択が一貫しているか (B-3-b)
   - 二重実装を全対象に強制しない方針が plan 内で揺れていないか
   - RD-B1 の `next.config.ts` host 固定値 `dev-duepure-tracker.jianrenzhongtian7.workers.dev` 限定 entry が本番 `tierlog.app` を誤って noindex にしないか (host 値の typo / 他 worker.dev URL への意図しない発火がないか)
   - 公開法務 3 page (`/terms` / `/privacy` / `/contact`) の server wrapper + client core 化で既存 client ロジックが壊れないか (ファイル移動のみで再実装しない方針が守られているか)
   - `/auth` を Plan B で **構造変更しない** 判断 (Codex 第 2 回確定) が Plan A の game/next 引き継ぎ修正の安全性を保ちつつ noindex 要件も満たすか
   - `/admin` `/account` の client page 分割しない判断と `X-Robots-Tag` header のみで noindex 実現する方針の妥当性
   - アプリ内部 `/dm/*` `/pokepoke/*` を **完全に触らない** 判断 (RD-B2) が SEO/AdSense 要件として妥当か
7. **B-3 `/share/[id]` noindex の方針**
   - `noindex, follow` の選択が SNS 流入と検索流入のバランスとして妥当か
   - 既存索引データへの影響 (一般公開前なので影響小、と plan が説明しているが Codex 側で再検証)
8. **B-4 公開ランディングの SSR 必須性**
   - `useSession()` 経由の client-side 判定 (案 ii) を排除した判断
   - cookie 依存の SSR 分岐が SEO 上問題ないか
   - ランディングコンテンツの最小限の質 (AdSense 審査基準への適合性)
9. **B-4 sitemap 整理**
   - `/${slug}/home` 削除で SEO 上の影響範囲 (既に index されている URL の取り扱い)
   - `/share/[id]` を sitemap 不掲載 + noindex でダブルガードする意図
10. **B-5 / B-6 文書化**
    - 観測責任分界表の網羅性 (本 plan で挙げた 7 行で十分か、他に必要な観測対象はないか)
    - 法務 gap analysis レポートの粒度 (Phase 3 で実装に困らない情報量か)
11. **Plan A との非破壊性**
    - Plan A 完了済の 4 件 (`shares.image_url` 二段防御 / legacy URL / BanGuard / auth `game/next`) が Plan B 実装後も動作することを保証する設計か
    - 特に B-3 の `/share/[id]` metadata 拡張で Plan A の `generateMetadata` 既存出力 (title/description/og:image) を **追加のみ** で改変していないか
12. **本 plan 単独で実装可能か**
    - 実装チャットが Plan B を読むだけで着手できるか (前提として AGENTS.md / CLAUDE.md / Plan A 完了報告は別途読了)
    - 未解決質問が解決済方針 (§10.A) と未解決 (§10.B) で明確に分かれているか

---

## 8. 想定タイムライン (参考)

| サブタスク | 実装 | dev preview 検証 | production 反映 |
|---|---|---|---|
| B-1 | 0.5 日 | 0.5 日 | 0.5 日 |
| B-5 | 0.5 日 (B-1 と並行) | — | — |
| B-3 (Codex 第 2 回でさらに縮小) | 0.5 日 (法務 3 page server 化 + `next.config.ts` headers 拡張のみ) | 0.5 日 | 0.5 日 |
| B-2 | 1 日 | 0.5 日 | 0.5 日 |
| B-4 | 2〜2.5 日 (placeholder 想定) | 1 日 | 0.5 日 |
| B-6 | 0.5 日 | — | — |
| 合計 | 約 5 日 | 約 2.5 日 | 約 2 日 |

Codex レビュー / plan-critic 反復を含めると **1 週間程度** が現実的なバッファ。Plan A 完了後の小さな次ステップとして、Plan B 全体を **約 1 週間以内** に収める方針。Codex 第 2 回で `/auth` server 化を撤回したため B-3 は最も小さなサブタスクの 1 つとなった。

---

## 9. ローカル検証コマンド (Plan B 統合)

```bash
# 静的検証 (全サブタスク共通)
npm run lint
npx tsc --noEmit
npm test -- --run

# 新規 helper のテスト (B-2)
npm test -- --run src/lib/og/fonts.test.ts

# Google Fonts fetch 残置の検出 (B-2)
git grep -nE 'fonts\.googleapis\.com|getFontFromGoogle' src/

# legacy permanentRedirect 残置の検出 (B-4)
git grep -nE 'permanentRedirect\(`/\$\{game\}/' src/app/page.tsx

# ハードコード URL の検出 (全サブタスク)
git grep -nE 'tierlog\.app|jianrenzhongtian7\.workers\.dev|uqndrkaxmbfjuiociuns\.supabase\.co' src/

# noindex 設定の grep (B-3)
git grep -nE 'noindex|robots:\s*\{\s*index:\s*false' src/

# Sentry beforeSend / sendDefaultPii の確認 (B-1)
grep -n "beforeSend\|sendDefaultPii\|release" src/sentry-worker.ts

# dev preview SSR HTML / header 確認
curl -sL https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/ | grep -E '<h1|<meta name="description"|<meta name="robots"'
curl -I https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/admin
curl -I https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/api/og/<existing-share-id>
```

---

## 10. 未解決質問

### 10.A 実装着手前に解くべき質問

**該当なし**。Plan B の全 open questions は Resolved Decisions (RD-B1 〜 RD-B10) + Codex 第 1 回 / 第 2 回 / 第 3 回反映で解決済。実装チャットは §Resolved Decisions と本文の確定方針に従って着手できる。

- RD-B1: dev preview noindex (固定値 host)
- RD-B2: per-page metadata ハイブリッド (公開法務 3 page のみ server 化)
- RD-B3: Sentry release (Version Metadata Binding)
- RD-B4: OG フォント (regular + bold 同梱)
- RD-B5: `/share/[id]` noindex follow
- RD-B6: SSR ランディング案 i
- RD-B7: placeholder 素材
- RD-B8: BanGuard で root `/` を exact + prefix 二段判定で公開除外 (Codex 第 3 回)
- RD-B9: `/dm/*` `/pokepoke/*` の index 抑止は `next.config.ts` `X-Robots-Tag` header (Codex 第 3 回)
- RD-B10: Workers Cache API は `globalThis.caches?.default` skip fallback + 独自ヘッダ検証 (Codex 第 3 回)

### 10.B 後回しでよい質問 (Phase 2 / Phase 3 で扱う)

1. **B-2 期限切れ share の OG cache invalidation 方針** (Phase 2 で対応)
2. **B-2 sub-set 化フォントの導入** (Phase 2 で対応、必須ではない)
3. **B-3 既に Google にインデックス済の URL の取り扱い** (一般公開前なので影響小、本番反映後の Search Console 確認は実装チャット側)
4. **B-4 多言語化 (英語ランディング)** (Phase 3 海外展開時)
5. **B-4 ヒーローセクションのコピーライティング詳細** (Phase 3 リブランディング時)
6. **B-5 client 側 (ブラウザ) Sentry の将来導入** (`src/sentry-worker.ts` コメント記載済、Plan B では対応しない)
7. **B-6 特商法ページ / consent UI / ads.txt 実装** (Phase 3 法務 / 広告 plan)

---

## 11. レビュー / 反映フロー

1. 本 plan ファイル作成 (完了時点)
2. `/review-plan-loop docs/plans/2026-05-27_plan_b_observability_og_seo.md` で plan-critic にレビューさせ、指摘を反映 → GO 判定まで反復
3. ユーザーが Codex に本 plan を渡してレビュー → Codex 指摘を Claude Code 側で反映 → 再度 plan-critic で差分レビュー (Plan A と同じパターン)
4. ユーザー承認後、別チャットで実装着手 (本 plan 作成チャットでは実装に入らない)
5. 実装後の検証 (Plan B 全体 §6) → user 承認 → production 反映

---

## 12. 補足

- 本 plan は統合レポート §4.5 / §4.6 / §4.7 / §5.1-5.3 のうち observability / OG / SEO 部分を実装単位化したもの。
- Plan A 完了報告 §7.3 で「Plan B 対象」と明示済の項目を網羅。
- Plan C (Multi-Game DB Scope) / Plan D (Access Gate) / Plan E (Phase 2) は本 plan と独立して別途作成。
- Phase 3 (Billing / Ads / Legal 実装) は本 plan B-6 の現状確認結果を入力として後続作成。

---

## Resolved Decisions

review-plan-loop 反復中にユーザー承認された判断事項を永続化する。本文の関連 section は本セクションを最終正とする。

### RD-B1 [noindex impl] dev preview 全体への `X-Robots-Tag` 付与方式 → **next.config.ts headers() (案 3)、host 固定値限定**

採用方針:

- `next.config.ts` の `headers()` に **dev preview host 限定の entry** を追加する。
- **host はまず固定値 `dev-duepure-tracker.jianrenzhongtian7.workers.dev` に限定** する。`.*workers\.dev` のような広い regex は初期実装では使わない (本番 `tierlog.app` と Cloudflare の他 worker.dev へ誤発火しないため厳格に固定)。
- 付与 header: **`X-Robots-Tag: noindex, nofollow, noarchive`** (3 値)。
- `middleware.ts` は触らない (CLAUDE.md 「auth/middleware 不変ルール」整合)。Custom Worker entry (`src/sentry-worker.ts`) も触らない (Sentry withSentry 衝突回避)。

選定理由:

- middleware.ts は auth / session refresh / legacy redirect を含む。Plan B で触ると Plan D (Access Gate / Auth Expiry) との衝突源になる。
- Custom Worker entry は Sentry の `withSentry` でラップ済。response wrap を追加すると Plan B-1 の Sentry 整備 + Cloudflare Cache (B-2) と多層化して複雑度上昇。
- 既存 `next.config.ts` に CSP / security headers (Strict-Transport-Security, X-Frame-Options, etc.) を集約済。`X-Robots-Tag` も同じ層に置くのが自然。
- Next.js 公式 docs で `headers()` の `has: [{ type: "host", value: ... }]` がサポート済。

検証 (Plan B-3 統合検証に追加):

- `curl -I https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/` で `x-robots-tag: noindex, nofollow, noarchive` が付くこと。
- `curl -I https://tierlog.app/` で `x-robots-tag` が **付かないこと**。
- `/share/<id>`, `/auth`, `/dm/home` など page 種別に関係なく dev preview 全体で付与されること。

棄却した案:

- **案 1 (middleware)**: CLAUDE.md「middleware.ts 不変ルール」の解釈リスク。
- **案 2 (Custom Worker entry)**: Sentry wrap との衝突可能性。
- **案 4 (見送り)**: dev preview index 防止は公開前に必須、見送り不可。

### RD-B2 [page meta] 各 page 固有 metadata の実装方針 → **ハイブリッド (公開ページのみ整備、アプリ内部ページは見送り)**

採用方針 (Codex 第 1 回 + 第 2 回指摘で確定、**公開法務ページのみ server 化 + sensitive ページは header only**):

- **server wrapper + client core 化対象は公開法務 3 page のみ**:
  - `/terms`
  - `/privacy`
  - `/contact`
- **header only で noindex を実現する対象**:
  - `/auth` (Codex 第 2 回確定: `/auth/page.tsx` の server wrapper 化は Plan B で行わない、Plan A の game/next 修正に対する regression リスクを取らないため)
  - `/admin` 配下 (client page の server wrapper 化なし、`next.config.ts` `X-Robots-Tag` header を基本)
  - `/account` 配下 (同上)
  - `/api/*` (Content-Type が JSON 等で metadata 適用外、header 必須)
- **既存 server component で metadata 拡張のみで完結する対象**:
  - `/share/[id]` (B-3-e: 既存 `generateMetadata` に `robots: { index: false, follow: true }` のみ追加、RD-B5)
  - `/` (B-4: SSR ランディング化、新規 server component で `metadata` 完備、RD-B6)
- **`/dm/*` / `/pokepoke/*` (page / metadata / server wrapper は対象外、ただし index 抑止 header は RD-B9 で実施)**:
  - per-page metadata 整備なし / sitemap 不掲載 / server wrapper + client core 分割なし。`dm/layout.tsx` / `pokepoke/layout.tsx` の `title.default = trackerName` を維持。
  - **ただし** index 抑止のため `next.config.ts` の `headers()` に `/dm/:path*` `/pokepoke/:path*` 用の `X-Robots-Tag: noindex, nofollow` entry を追加する (**RD-B9** で確定)。
  - 旧 plan の「robots.txt Disallow / noindex 対象」記述は **現状の `src/app/robots.ts` が `/dm` `/pokepoke` を Disallow していない事実と矛盾** するため削除済 (Codex 第 4 回反映)。
  - 本格的な per-page SEO 整備 (title / canonical / OGP の精緻化) は Phase 2 以降の別 issue。

選定理由:

- 案 1 (全 page server wrapper + client core 分割) の 16〜18 page リファクタは Plan B の scope を肥大化させ、Plan A 完了後の小さな次ステップという意図と乖離する。
- 案 2 (layout 動的 title) は path 判定の複雑化、案 3 (useEffect + document.title) は SSR HTML に反映されず SEO 効果薄、いずれも Plan B では採らない。
- **公開対象ページに限定**することで、AdSense / 検索流入向けに必要な title/description/canonical/OGP を確実に整え、リファクタ規模を最小化する。
- アプリ内部ページは SEO 集客対象外であり、per-page metadata 整備の優先度は低い。index 抑止は **RD-B9 の `next.config.ts` `X-Robots-Tag: noindex, nofollow` header で担保**する (現状 `src/app/robots.ts` は `/dm` `/pokepoke` を Disallow していない事実を踏まえた整理)。

実装対象一覧 (Plan B 内、Codex 第 2 回確定):

| Path | metadata 整備内容 | client/server 構造 | 実装層 |
|---|---|---|---|
| `/` | Plan B-4 で SSR ランディング化、`metadata` 完備 | server component (新規 / 置換) | metadata |
| `/terms` | 現状 `"use client"`。**server wrapper + client core に分割**し、`metadata: { title, description, alternates: { canonical: "/terms" } }` を export | server wrapper + client core (新規) | metadata |
| `/privacy` | 同上、`alternates: { canonical: "/privacy" }` | 同上 | metadata |
| `/contact` | 同上、`alternates: { canonical: "/contact" }` | 同上 | metadata |
| `/share/[id]` | Plan A の `generateMetadata` を維持し `robots: { index: false, follow: true }` のみ追加 (B-3-e) | 既存 server component (構造変更なし) | metadata |
| `/auth` | `X-Robots-Tag: noindex, nofollow, noarchive` を `next.config.ts` で付与のみ。**server wrapper + client core 分割は行わない** (Codex 第 2 回確定) | 既存 client component (構造変更なし) | header only |
| `/admin/*` | `X-Robots-Tag: noindex, nofollow` を `next.config.ts` で付与。**client page 分割は行わない** (Codex 第 2 回確定) | 既存 client component (構造変更なし) | header only |
| `/account/*` | 同上 | 同上 | header only |
| `/api/*` | `X-Robots-Tag: noindex` を `next.config.ts` で付与 | API route (構造変更なし) | header only |
| `/dm/*` `/pokepoke/*` | **page / metadata / server wrapper は対象外** (per-page metadata なし、sitemap 不掲載、server wrapper 分割なし)。**ただし index 抑止は RD-B9 の `next.config.ts` `X-Robots-Tag: noindex, nofollow` header で実施** | 既存 client component (構造変更なし) | header only (RD-B9) |

リファクタ規模 (Codex 第 2 回反映):

- **server wrapper + client core 分割対象は法務 3 page (`/terms` / `/privacy` / `/contact`) のみ**。
- `/share/[id]` は既存 server で metadata 拡張のみ、`/` は B-4 で別途置換 (新規 server)。
- `/auth` / `/admin` / `/account` / `/api/*` / `/dm/*` / `/pokepoke/*` は **client page 分割なし**、header only または対象外。
- 旧案の「dm/pokepoke 全 page + `/account` + `/admin`」分も「`/auth` server wrapper 化」も対象外。

検証:

- `npx tsc --noEmit` で型エラーなし。
- `curl -sL https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/terms | grep -E '<title>|<meta name="description"|<link rel="canonical"'` で公開ページに固有 title/description/canonical が SSR HTML に出力されている。
- `curl -I .../auth` で `X-Robots-Tag: noindex, nofollow, noarchive` を含むこと (Codex 第 2 回確定: header only、`<meta>` 経由の出力は不要、`/auth/page.tsx` は触らない)。
- `/dm/home` の SSR HTML は現状 (layout default title) のままで OK = regression なし。
- dev preview で `/terms` `/privacy` `/contact` の遷移 / state / 既存ロジックが壊れない (client core 移動のみのため通常は影響なし)。`/auth` は構造変更しないため `git diff src/app/auth/page.tsx` で差分なしを確認 (§B-3 検証 line 449 と同じ観点)。

棄却した案:

- **案 1 (全 page server wrapper + client core 分割)**: 16〜18 page リファクタは Plan B の scope を肥大化させる。
- **案 2 (layout 動的 title)**: path 判定の複雑化、SEO 効果中。
- **案 3 (useEffect + document.title)**: SSR HTML に反映されず SEO 効果薄。
- **案 4 (per-page metadata 見送り全件)**: 公開ページの canonical / description 不在は AdSense 審査でリスク。

---

### RD-B3 [release source] B-1 Sentry `release` 取得経路 → **Cloudflare Version Metadata Binding**

採用方針 (Codex 第 1 回指摘により実装前確定):

- `wrangler.jsonc` に `version_metadata: { binding: "CF_VERSION_METADATA" }` を追加することを **plan で明示許可** する。
- `src/sentry-worker.ts` で `env.CF_VERSION_METADATA?.id` を `release` 値として `Sentry.withSentry` config に渡す。
- 公式 docs (Cloudflare Workers Version Metadata Binding) の確認は **実装チャット側で WebFetch 必須** (AGENTS.md「外部サービス操作前に公式ドキュメント確認」厳守)。
- fallback: binding 未設定 / 値 undefined の場合は `"unknown"` を渡す。Build variable (`WORKERS_CI_COMMIT_SHA`) 経由は採らない (Custom Worker entry での到達性が不確実、Version Metadata Binding が標準経路)。

理由: Cloudflare 公式の標準経路で Custom Worker entry に届く確実性が高く、deploy id (Cloudflare の `script_version_id` ベース) と Sentry issue を 1:1 で紐付けられる。

### RD-B4 [og fonts] B-2 OG ルートの regular weight フォント同梱 → **regular + bold 両方を同梱**

採用方針:

- `public/fonts/NotoSansJP-Regular.ttf` (新規) と `public/fonts/NotoSansJP-Bold.ttf` (既存 `src/assets/fonts/` から移動) の **両方を同梱**する。
- `next/og` の `ImageResponse` で `fonts: [{ name, data, weight: 400 }, { name, data, weight: 700 }]` の 2 件を渡す。
- **repo size 増加を明記**: regular 約 9MB + bold 約 9MB = 計 約 18MB の git tracked binary 増。Plan B 本実装時に確認の上で commit。
- **subsetting (常用漢字 + ひらがな + カタカナ等のみ抽出) は Phase 2 / optional**。本 plan では full set を使う。約 1〜2MB まで削減可能だが、Plan B では実施しない (実装複雑度を抑えるため)。

理由: Bold のみだと「副題や数字も全部太字」になり可読性が下がる。SNS プレビューのブランド体験を優先。

### RD-B5 [share noindex] B-3-e `/share/[id]` の index/noindex → **`noindex, follow`**

採用方針:

- `src/app/share/[id]/page.tsx` の `generateMetadata` 戻り値に `robots: { index: false, follow: true }` を追加する。
- 既存の title / description / openGraph / twitter は **そのまま維持** (Plan A 完了済の出力)。

理由:

- 個人ユーザーの戦績スクショを Google 検索結果に晒すのは UX / プライバシー観点で好ましくない。
- SNS シェア (X / Discord) では OG プレビューを出すが、検索結果には出さない (`noindex`)。
- 共有ページ内の `/${gameSlug}/home` などへの内部リンクはクロール可能にしたいので `follow` を維持。
- 一般公開前段階で Google にインデックス済の URL はほぼゼロ → 削除影響なし。

### RD-B6 [landing impl] B-4 公開ランディング実装案 → **案 i (SSR ランディング)**、既存 redirect 廃止許容

採用方針:

- `src/app/page.tsx` (root) を **SSR ランディング**に置換 (B-4-a 案 i)。
- 既存ログイン済ユーザーが直接 `/` を踏んだときの「Cookie 依存 `permanentRedirect` で `/${game}/home` に即遷移」挙動は **廃止許容** (ユーザー明示承認済)。
- 代わりに、SSR ランディング上で「アプリを開く」CTA ボタンを **目立たせて配置** し、ログイン済ユーザーが 1 クリックで `/${defaultGame}/home` に遷移できるようにする (CTA の視認性を意図的に上げる)。
- defaultGame は cookie (`selectedGame`) または cookie 不在時は `DEFAULT_GAME = "dm"`。

理由: SEO / AdSense 審査で SSR HTML に意味のあるコンテンツが必要。既存挙動の 1 クリック増を許容することで SSR ランディングを成立させる。

### RD-B7 [landing assets] B-4 ランディングのスクリーンショット素材 → **placeholder / 既存 UI スクショで構造作成**

採用方針:

- 初期実装では **placeholder 画像 (Tierlog ロゴ入りの simple な仮画像) + 既存 UI のスクショ流用**で構造を作る。
- 実物の良質スクリーンショット (戦績入力フォーム、stats チャート、Discord チーム連携など) の差し替えは **Plan B の後続 PR / Phase 2 で対応** する。
- Plan B-4 完了の判定基準は「SSR ランディングが描画され、SEO 関連 metadata が正しく出ること」とし、デザイン完成度の高さは別途継続改善。

理由: 素材待ちで Plan B 全体がブロックされるのを避ける。SSR ランディングの構造 (見出し / 説明 / CTA / OGP) は素材ゼロでも作れる。

### RD-B8 [banguard root excl] B-4 BanGuard で root `/` を公開除外する最小修正 → **exact + prefix 二段判定**

採用方針 (Codex 第 3 回指摘により確定):

- `src/components/providers/BanGuard.tsx` の `EXCLUDED_PATHS` 判定ロジックを **exact match (root) + prefix match (既存)** の二段に拡張:
  ```ts
  const EXACT_PUBLIC_PATHS = ["/"];
  const PUBLIC_PREFIXES = ["/auth", "/terms", "/privacy", "/contact", "/share"];
  const isExcluded =
    EXACT_PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  ```
- **`EXCLUDED_PATHS` に単純に `"/"` を追加する案は禁止** (`pathname.startsWith("/")` で全 path bypass されて BanGuard 全停止になる)。
- Plan A で確立した retry + fail-open + anonymous redirect + stage===4 BAN 画面ロジックは **そのまま維持**、判定 helper のみ拡張する最小差分。
- **Plan A の BanGuard 再実装ではない**。B-4 の公開 root 対応に必要な最小修正として扱う。
- BAN ユーザー (`stage === 4`) が `/` ランディングを閲覧できる挙動は許容 (重要操作は `/dm/*` `/pokepoke/*` 配下で従来通り BAN 画面)。

選定理由:

- B-4-a で root を SSR 公開ランディング化しても、現状 `EXCLUDED_PATHS` に `/` が含まれていないため hydration 後に BanGuard が `/auth` redirect → SSR ランディングが消える。
- exact match + prefix match の二段判定なら root だけを安全に公開除外でき、`/dm/home` 等は従来通り認証 redirect される。
- Plan D で正式な access gate が入る前段の暫定設計 (Plan A の BanGuard fail-open + retry と同じ位置付け)。

検証:

- 未ログインで `/` 訪問 → SSR ランディング描画後も維持される。
- 未ログインで `/dm/home` 訪問 → 従来通り `/auth` redirect。

### RD-B9 [internal index suppression] `/dm/*` `/pokepoke/*` の index 抑止 → **`next.config.ts` `X-Robots-Tag` header 追加**

採用方針 (Codex 第 3 回指摘により確定):

- `next.config.ts` の `headers()` に **`/dm/:path*` と `/pokepoke/:path*` 用の `X-Robots-Tag: noindex, nofollow` entry** を追加する。
- これにより `/dm/*` `/pokepoke/*` の検索エンジン index を確実に抑止する。

選定理由:

- 現状の `src/app/robots.ts` の Disallow は `/admin /account /api /auth` のみで **`/dm` `/pokepoke` を含まない**。
- middleware の認証 redirect だけでは「外部リンク経由で Googlebot が `/dm/home` の認証 redirect 前 HTML を一瞬触れる」可能性を排除しきれない。
- header 追加なら **client page を一切触らず**完結する (RD-B2 「アプリ内部 page の server wrapper / client core 分割なし」と両立)。
- 既存 `next.config.ts` の `headers()` には RD-B1 で dev preview noindex entry を追加する予定があり、同じ場所に並べて per-path entry を追加するだけ。

棄却した案:

- **robots.txt に `/dm` `/pokepoke` を Disallow 追加**: robots.txt は強制力が弱く (準拠 crawler 限定)、`X-Robots-Tag` の方が確実。
- **見送り**: robots.txt が抑止していない / sitemap 不掲載のみ / landing CTA から crawler 到達リスク、を残す形は「未解決質問ゼロ」方針に反するため不採用。

検証 (Codex 第 4 回で `X-Robots-Tag` 重複時の期待値を確定):

| 環境 + path | 期待される `X-Robots-Tag` の実効値 |
|---|---|
| **dev preview** `/dm/home` / `/pokepoke/home` | `noindex, nofollow, noarchive` を **実効的に含む** こと (dev preview 用 host 固定 entry (RD-B1) と `/dm/:path*` / `/pokepoke/:path*` entry (RD-B9) が両方該当するため、3 値すべてが含まれる) |
| **production** `/dm/home` / `/pokepoke/home` | `noindex, nofollow` を含み、**dev preview 専用の `noarchive` は付かない** こと (RD-B9 entry のみ該当) |
| **production** `/` (root ランディング) | dev preview 用 noindex header (RD-B1) が **付かない** こと (root は RD-B9 / RD-B1 のどちらの entry にも該当しないため `X-Robots-Tag` ヘッダなし、default index) |

**`next.config.ts` の headers() 実装方針**:

- 同一 path に複数の entry がマッチする場合、Next.js は **両方の header を付与** する (`source` ごとに評価し、header を merge)。
- 実装後 `curl -I` 検証で上記の期待値を満たさない場合 (例: dev preview `/dm/home` で `noarchive` が消える、production `/dm/home` で `noarchive` が付く等)、**`next.config.ts` の entry 順序を入れ替える** か、**source を分割する** (例: dev preview entry を `/((?!api).*)` などより精密な source に絞る) ことで期待値を満たすよう調整する。
- 検証手順:
  - dev preview: `curl -sI https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/dm/home | grep -i x-robots-tag` → 3 値 (`noindex, nofollow, noarchive`) を含む
  - production: `curl -sI https://tierlog.app/dm/home | grep -i x-robots-tag` → 2 値 (`noindex, nofollow`) のみ、`noarchive` を含まない
  - production root: `curl -sI https://tierlog.app/ | grep -i x-robots-tag` → 該当 header なし

### RD-B10 [workers cache fallback] B-2 Workers Cache API の fallback と検証ヘッダ → **`globalThis.caches?.default` skip + 独自ヘッダ検証**

採用方針 (Codex 第 3 回指摘により確定、Codex 第 4 回で実装注意追記):

- **環境フォールバック**:
  - `globalThis.caches?.default` が存在しない場合 (ローカル `next dev` / Node テスト環境) は **cache layer 全体をスキップ** する。
  - `getCloudflareContext()` の呼び出しは **`try/catch` で囲む** (ローカル dev で throw する可能性)。失敗時は `ctx.waitUntil` を使わず `await cache.put(...)` で同期書き込みに fallback。
- **検証ヘッダ**:
  - cache hit/miss の検証は **独自ヘッダ `X-Tierlog-OG-Cache: HIT | MISS`** を OG response に付与して行う。
  - `cf-cache-status: HIT` は Cloudflare のエッジ cache (Workers Cache とは別レイヤ) で、Workers Cache API のヒット判定としては確実ではない。
- **実装注意 1: cached Response の headers immutability** (Codex 第 4 回追加):
  - `cache.match(request)` が返す Response の `headers` は **immutable な可能性** がある (Workers ランタイムの仕様)。直接 `cached.headers.set("X-Tierlog-OG-Cache", "HIT")` を呼ぶと `TypeError: Headers are immutable` で throw する。
  - 修正パターン: **`new Response(cached.body, cached)` で wrap してから header を set** する。具体例:
    ```ts
    const cached = await cache.match(request);
    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set("X-Tierlog-OG-Cache", "HIT");
      return response;
    }
    ```
  - `new Response(body, init)` で `init` に既存 Response を渡すと status / headers / statusText が継承される (Web 標準)。
- **実装注意 2: cache.put() 失敗時の挙動** (Codex 第 4 回追加):
  - `cache.put()` / `ctx.waitUntil(cache.put(...))` が失敗 (例: storage quota / rate limit / 一時的 binding 不調) しても、**OG response 自体は成功させる**。
  - cache 書き込み失敗は **`console.warn` 程度に留める** (Sentry 報告は不要、運用上重要でない backend 失敗)。
  - **ユーザー向けレスポンスを 500 にしてはいけない**: cache は性能最適化レイヤであり、書き込み失敗はユーザー体験に影響しないため、生成済の `ImageResponse` をそのまま返す。
  - 実装パターン:
    ```ts
    try {
      ctx.waitUntil(cache.put(request, response.clone()));
    } catch (e) {
      console.warn("OG cache put failed:", e);
      // continue: do not throw, return response anyway
    }
    return response;
    ```

選定理由:

- Workers Cache API はランタイム依存で、CI / ローカルテスト / Node 環境で動かない。`globalThis.caches?.default` の null check で early return すれば本番のみで動作する設計が安全。
- `cf-cache-status` をテストに使うと「Workers Cache はミスだがエッジ cache はヒット」のケースで誤判定する。独自ヘッダなら確実。

検証:

- 本番 / dev preview で `curl -I` 2 回叩いて 2 回目に `X-Tierlog-OG-Cache: HIT` が付く。
- ローカル `npm run dev` で `curl` → 独自ヘッダなし (cache layer skip)、画像は正常返却。

---

## 本文への RD 反映 (cross-ref)

本文の関連 section は今後 RD-B1 〜 RD-B10 を一次正として参照する:

- **§B-1-c** 「`release` 設定」: **RD-B3** で確定。`wrangler.jsonc` に Version Metadata Binding を追加、`env.CF_VERSION_METADATA?.id` を release 値に。fallback は `"unknown"`。
- **§B-2-a** 「フォントのローカル同梱」: **RD-B4** で確定。regular + bold 両方同梱、`public/fonts/` 配下。subsetting は Phase 2。
- **§B-3-c** 「dev preview の全体 noindex」: **RD-B1** で確定。`next.config.ts` の `headers()` に host 固定値 (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) 限定の entry を追加し `X-Robots-Tag: noindex, nofollow, noarchive` を付与。middleware / Custom Worker は触らない。
- **§B-3-a / §B-3-b / §B-3-d** 「公開ページの固有 metadata 整備」: **RD-B2 + Codex 第 2 回 + 第 4 回**で確定。**server wrapper + client core 化対象は公開法務 3 page (`/terms` / `/privacy` / `/contact`) のみ**。`/auth` / `/admin` / `/account` / `/api/*` は `next.config.ts` `X-Robots-Tag` header だけで noindex 付与 (client page 分割なし)。`/share/[id]` は既存 server で metadata 拡張のみ。`/dm/*` / `/pokepoke/*` は **per-page metadata / sitemap 掲載 / client page 分割は対象外**、**ただし index 抑止 header は RD-B9 の `next.config.ts` `X-Robots-Tag: noindex, nofollow` で実施**。
- **§B-3-e** 「`/share/[id]` の noindex 追加」: **RD-B5** で確定。`robots: { index: false, follow: true }` を追加。
- **§B-4-a** 「ルート (`/`) の公開ランディング化」: **RD-B6** で確定。案 i (SSR) 採用。ログイン済ユーザーの 1 クリック追加を許容、CTA を目立たせる。
- **§B-4-b** 「ランディングコンテンツの設計」: **RD-B7** で確定。placeholder / 既存スクショで初期構造、差し替えは Phase 2。
- **§B-4-e** 「BanGuard で root `/` を公開除外する最小修正」: **RD-B8** で確定 (Codex 第 3 回追加)。exact + prefix 二段判定、Plan A の BanGuard ロジック維持。
- **§B-3-a / §B-3-d** 「`/dm/*` `/pokepoke/*` の index 抑止」: **RD-B9** で確定 (Codex 第 3 回)。`next.config.ts` `X-Robots-Tag: noindex, nofollow` header 追加、client page 触らず。
- **§B-2-d** 「Workers Cache API」: **RD-B10** で確定 (Codex 第 3 回)。`globalThis.caches?.default` skip fallback、独自ヘッダ `X-Tierlog-OG-Cache` で検証。
- **§7 Codex 観点**: middleware host 判定 / per-page metadata 大規模リファクタ等の古い観点を削除済。RD-B1〜RD-B10 + Codex 第 1 回 / 第 2 回 / 第 3 回確定後の残り検証観点に絞り込み。
- **§10.A**: **該当なし** (全 open questions resolved)。
- **§10.B**: Phase 2 / Phase 3 で扱う長期項目のみ残置。

---

## Codex Review Feedback

### Codex Review 第 1 回 (2026-05-27)

主要 3 点 + 補足を反映 (反復 1〜2 で適用):

| # | Codex 第 1 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | RD-B2 を「全 page server wrapper + client core」→「ハイブリッド (公開ページのみ整備)」に書き換え | RD-B2 / §B-3-d / §B-3-a / §B-3 検証・リスク / §4 / §6 / §7 / §10.A / cross-ref | 一括 server 化を撤回、公開ページのみ整備 |
| 2 | RD-B1 と矛盾する古い記述 (middleware 経由 host 判定、広い `*.workers.dev` 判定、Custom Worker 候補等) を削除 | §B-3-c / §B-1-d / §7 観点 #3 | RD-B1 整合の固定値 host 限定に統一 |
| 3 | §10.A の質問 5 件を RD-B3〜RD-B7 として Resolved Decisions に落とし、§10.A を「該当なし」に | RD-B3 / RD-B4 / RD-B5 / RD-B6 / RD-B7 / §10.A | 実装着手前の未解決質問をゼロに |
| 補足 | ヘッダステータス更新、B-3 工数縮小、Plan B 全体を約 1 週間以内に | ヘッダ / §4 / §8 | 反映済 |

### Codex Review 第 2 回 (2026-05-27、第 1 回反映後の追加レビュー)

主要 5 点を反映 (本ターン):

| # | Codex 第 2 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | `/dm/*` `/pokepoke/*` の扱いを統一 (RD-B2 と path 表の `index, follow (検索対象)` が矛盾) | §B-3-a path 表 / §B-3 対象ファイル候補 / RD-B2 実装対象一覧 / §6 SEO 行 / cross-ref | `/dm/*` `/pokepoke/*` 配下を **Plan B 完全対象外** に統一。per-page metadata / sitemap 掲載 / 分割すべて実施しない。`index, follow (検索対象)` 表記を削除 |
| 2 | `/auth` を `next.config.ts` `X-Robots-Tag` header **のみ** に確定 (server wrapper + client core 分割は Plan B で行わない) | §B-3-a / §B-3-d / RD-B2 実装対象一覧 / §6 検証 / リスク 4 | `/auth/page.tsx` 構造変更なし。Plan A の game/next 引き継ぎ修正に対する regression リスクを取らない |
| 3 | `/admin` / `/account` の client page 分割を行わない、header 基本 + 安全な server layout 限定で metadata 補助併用可 | §B-3-a / §B-3-d / RD-B2 実装対象一覧 / §6 検証 | client page 分割禁止、`X-Robots-Tag` header を基本とし、既存 server layout への metadata 追加のみ可 |
| 4 | B-3-b の「metadata + X-Robots-Tag 二重実装」表現を弱め、対象ごとに最適な実装層を選ぶ整理に | §B-3-b 全面書き換え | 公開法務ページ → metadata、sensitive ページ → header、dev preview → host 固定 header の per-対象選択。二重実装は強制しない |
| 5 | ステータス・cross-ref・Codex 観点を最新化 | ヘッダ / §4 / §6 / §7 #6 / §10.A / cross-ref | 「Codex レビュー第 2 回指摘反映中」に更新、B-3 工数 0.5 日に縮小、§7 観点 #6 を Codex 第 2 回確定で書き換え |

**Codex 第 2 回反映の結果**:

- server wrapper + client core 化対象は **3 page (`/terms` / `/privacy` / `/contact`) のみ** に縮小 (旧 4 page から `/auth` を撤回)。
- client page 分割対象は **公開法務ページに完全に限定**、sensitive / app-internal ページ (`/auth` / `/admin` / `/account` / `/dm/*` / `/pokepoke/*`) は構造変更ゼロ。
- B-3 工数は 0.5〜1 日 → 0.5 日に短縮。Plan B 全体は約 5 日。

### Codex Review 第 3 回 (2026-05-27、第 2 回反映後の追加レビュー)

主要 4 点を反映 (本ターン):

| # | Codex 第 3 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | root ランディングと BanGuard の整合追加 (B-4 SSR ランディング化と現 BanGuard `EXCLUDED_PATHS` の不整合解消) | §B-4 対象ファイル候補 / §B-4-e (新規 sub-task) / §B-4 検証 / RD-B8 / §6 統合検証 / cross-ref | `src/components/providers/BanGuard.tsx` を B-4 対象ファイル候補に追加、exact match (root) + prefix match の二段判定で root だけ公開除外する最小修正を明記。`pathname.startsWith("/")` で全 page bypass する単純追加は禁止と明示。検証に「未ログインで `/` 維持」「未ログインで `/dm/home` は `/auth` 誘導」の 2 件追加 |
| 2 | `/dm/*` `/pokepoke/*` の index 抑止説明を修正 (現 robots.ts が `/dm` `/pokepoke` を Disallow していない事実反映) | §B-3-a path 表 / §B-3-d / RD-B9 / §6 統合検証 / cross-ref | 「middleware 認証 redirect + robots.txt Disallow で抑止」記述を削除。`next.config.ts` `headers()` に `/dm/:path*` `/pokepoke/:path*` 用の `X-Robots-Tag: noindex, nofollow` entry 追加方針 (header だけで完結、client page 触らず RD-B2 と両立) を確定 |
| 3 | B-2 Workers Cache API fallback / 検証を明確化 | §B-2-d / §B-2 検証 / RD-B10 / §6 統合検証 | `globalThis.caches?.default` 不在時に cache layer スキップ、`getCloudflareContext()` を try/catch、独自ヘッダ `X-Tierlog-OG-Cache: HIT/MISS` で検証する方針を確定 (`cf-cache-status` は別レイヤなので使わない) |
| 4 | ステータス / cross-ref / Codex 観点 / タイムライン更新 | ヘッダ / §4 / §6 / §10.A / Resolved Decisions (RD-B8/B9/B10 追加) / cross-ref | 「Codex レビュー第 3 回指摘反映中」に更新、本反映を Codex Review Feedback に追加 |

**Codex 第 3 回反映の結果**:

- B-4 に **新規 sub-task B-4-e (BanGuard 最小修正)** を追加。Plan A の BanGuard ロジックは維持し、判定 helper のみ拡張。
- `/dm/*` `/pokepoke/*` の index 抑止が `next.config.ts` header で確実化。robots.ts の Disallow 不在問題に対応。
- Workers Cache API がローカル / Node で safe にスキップされ、独自ヘッダで cache 動作を確実に検証可能。
- Resolved Decisions に **RD-B8 / RD-B9 / RD-B10** を追加 (累計 10 件)。

### Codex Review 第 4 回 (2026-05-27、第 3 回反映後の文書整合最終修正)

主要 4 点を反映 (本ターン、新規 RD なし、既存 RD の文書整合とりまとめ):

| # | Codex 第 4 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | RD-B2 の古い `/dm/*` `/pokepoke/*` 記述を RD-B9 と同期 | RD-B2 採用方針 / RD-B2 実装対象一覧 / cross-ref | 「robots.txt Disallow / noindex 対象」という現状 robots.ts と矛盾する記述を削除。実装対象一覧の `/dm/*` `/pokepoke/*` 行の実装層を `—` から「header only (RD-B9)」に変更。cross-ref の「完全対象外」を「per-page metadata / sitemap 掲載 / client page 分割は対象外、ただし index 抑止 header は RD-B9 で実施」に揃え |
| 2 | `X-Robots-Tag` 重複時の期待値を確定 | RD-B9 検証セクション | dev preview `/dm/home` `/pokepoke/home` は実効的に `noindex, nofollow, noarchive` 3 値含む、production `/dm/home` `/pokepoke/home` は `noindex, nofollow` のみ (`noarchive` なし)、production `/` は header なし、を期待値として明記。実装後に期待値を満たせない場合は `next.config.ts` entry 順序 / source 分割で調整する方針 |
| 3 | RD-B10 Workers Cache 実装注意追記 | RD-B10 採用方針 | 実装注意 1: cached Response の headers が immutable な可能性 → `new Response(cached.body, cached)` で wrap してから header set。実装注意 2: `cache.put()` 失敗時は `console.warn` 程度に留め、OG response 自体は 500 にせず生成済画像を返す |
| 4 | ステータス更新 | ヘッダ / Codex Review Feedback | 「Codex レビュー第 4 回指摘反映中」に更新、本対応表を Codex Review Feedback に追加 |

**Codex 第 4 回反映の結果**:

- RD-B2 と RD-B9 の文書整合が完全に取れ、`/dm/*` `/pokepoke/*` の扱いが「page 触らず + header だけで noindex」で plan 全体で一貫。
- `X-Robots-Tag` 重複時の期待値が確定し、実装後の検証コマンド (curl) で誰でも GO 判定可能。
- Workers Cache の実装ハマりポイント (immutable headers / put 失敗時) が明文化され、実装者が plan 単独で安全に対応可能。
- **新規 RD なし** (RD-B1〜RD-B10 の文書整合のみ)。実装可能水準は維持。

### Codex Review 第 5 回 (2026-05-27、完成版最終整理)

主要 3 点を反映 (本ターン、**第 5 回は文書表現のみの最終整理、設計変更なし**):

| # | Codex 第 5 回指摘 | plan 反映先 | 反映内容 |
|---|---|---|---|
| 1 | RD-B2 選定理由の「robots.txt Disallow / noindex 対象」記述修正 | RD-B2 選定理由 | 「アプリ内部ページは認証必須で `robots.txt` Disallow / noindex 対象」を「アプリ内部ページは SEO 集客対象外であり、per-page metadata 整備の優先度は低い。index 抑止は RD-B9 の `next.config.ts` `X-Robots-Tag: noindex, nofollow` header で担保する」に置換。現状 `src/app/robots.ts` は `/dm` `/pokepoke` を Disallow していない事実を反映 |
| 2 | B-3 リスク 2 の「完全対象外」を正確化 | §B-3 リスク / rollback | `/dm/*` `/pokepoke/*` の 12 page を「完全対象外」から「**client page / per-page metadata / sitemap 掲載は対象外** (ただし index 抑止 header は RD-B9 で実施)」に表現変更。RD-B9 と矛盾しない表現に統一 |
| 3 | ヘッダステータスを完成版に更新 | ヘッダ / Codex Review Feedback | 「Codex レビュー第 4 回指摘反映中」を「**完成 / 実装可能水準** (plan-critic 累計 12 反復 + Codex 第 1〜5 回反映完了、未解決質問ゼロ)」に更新 |

**Codex 第 5 回反映の結果**:

- **設計変更ゼロ、新規 RD なし**。全 3 点が文書表現の最終整理のみ。
- 古い「robots.txt Disallow で抑止」前提に基づく文言が plan 全体から完全に排除され、RD-B9 (header で抑止) が一貫した正となった。
- ヘッダステータスが「完成 / 実装可能水準」に更新され、別チャットで実装着手可能な状態を明示。
- Plan B は **Codex 5 周 review + plan-critic 12 反復**を経て、文書としても設計としても実装可能水準に到達。
