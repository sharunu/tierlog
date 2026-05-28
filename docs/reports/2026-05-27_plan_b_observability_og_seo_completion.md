# 実装報告書: Plan B Observability / OG / SEO 本番反映完了

- 報告日: 2026-05-27
- 対象 plan: `docs/plans/2026-05-27_plan_b_observability_og_seo.md`
- 元レポート: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` §4.5 / §4.6 / §4.7 / §5.1-5.3
- 前提 plan: `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md` (Plan A 完了済)
- ステータス: **dev 実装 + dev preview 検証 + main 反映 + 本番 smoke check + 本番 OG 実機確認まで完了**
- 関連 commit (新しい順):
  - `49ccd54 Merge branch 'dev'` (main 反映)
  - `ea71278 fix(plan-b): Codex 第 7 回 P3 2 件を反映`
  - `5b2f25c fix(plan-b): 本番 root の metadata.robots を undefined に変更`
  - `4a541fa fix(plan-b): X-Robots-Tag CDN 切詰めを <meta robots> 経由で補完`
  - `3b0ec00 fix(plan-b): X-Robots-Tag を multi-value append 形式に変更`
  - `64ca256 fix(plan-b): Codex 第 6 回 dev preview 実測指摘 4 件を反映`
  - `5213ae3 feat(plan-b): Observability / OG / SEO 一式 (B-1〜B-6)`
- DB migration: **なし** (Plan B はコードと assets のみ)

---

## 1. サマリ

統合 audit (`2026-05-27_integrated_pre_public_monetization_audit.md`) で抽出された一般公開前ブロッカーのうち、Observability / OG / SEO に該当する 6 件 (B-1 〜 B-6、P1 4 件 + P2 2 件) を Plan B として実装し、本番 (`https://tierlog.app`) まで反映を完了した。

- **B-1 Observability**: Sentry `beforeSend` scrubber + `sendDefaultPii: false` + Cloudflare Workers Version Metadata Binding 経由の `release` + staging / production の `environment` 分離
- **B-2 OG**: Google Fonts fetch 廃止 (SPOF 解消) + ASSETS binding 経由ローカル同梱 + Workers Cache + 想定外例外時の 1200×630 fallback
- **B-3 SEO**: dev preview / per-path の X-Robots-Tag (Custom Worker entry) + `<meta name="robots">` 補完 (CDN の comma-separated 切詰め回避) + 公開法務 3 page の server wrapper + client core 化 + canonical / OG / Twitter metadata
- **B-4 公開ランディング**: cookie 依存の root `permanentRedirect` 廃止 → SSR ランディング + sitemap 整理 + BanGuard exact + prefix 二段判定で root 公開除外
- **B-5 Observability runbook**: 責任分界表 + Sentry runbook 新規
- **B-6 法務 gap analysis**: 現状 OK の確認 + AdSense / Stripe / GDPR 導入時の不足項目リスト (実装は Phase 3)

Plan B は plan-critic 12 反復 + Codex 5 周 (plan 確定) + Codex 第 6 回 (dev preview 実測指摘) + Codex 第 7 回 (P3 2 件) を経て、本番 smoke check 8 項目 + `/api/og/<share_id>` 実機確認まで全パス。Plan A 完了済の 4 件 (`shares.image_url` 二段防御 / auth `game`/`next` 引き継ぎ / BanGuard fail-open + retry / legacy URL) は非破壊で維持。

任意外部 `image_url` を許容する方向への後退なし。auth/callback の既存 SIGNED_IN 処理、middleware.ts は touch せず。

---

## 2. 実装内容

### 2.1 B-1: Sentry scrubber / release / environment 強化

#### 背景
Plan A 完了時点の `src/sentry-worker.ts` では `@sentry/cloudflare` の default 動作で Authorization / Cookie / token / Supabase publishable key 等が Sentry に送出されうるリスクが残存。`release` 未設定で deploy ごとの分離不能、`environment` 判定が Runtime セクション登録漏れに弱い、という 3 つの穴を一括解消する。

#### 変更ファイル
- `src/sentry-worker.ts` (全面リファクタ)
- `wrangler.jsonc` (`version_metadata` binding 追加)
- `docs/runbooks/sentry-runbook.md` (新規、B-5 で記述)

#### 実装ポイント
- `beforeSend(event, hint)` を追加し、以下を `[Filtered]` に置換:
  - **HTTP headers** (`event.request?.headers`): `authorization` / `cookie` / `set-cookie` / `x-internal-key` / `x-supabase-*` / `apikey` を case-insensitive で検出
  - **URL query string** (`event.request?.url` / `query_string` / breadcrumb url): `access_token` / `refresh_token` / `id_token` / `provider_token` / `provider_refresh_token` / `code` (OAuth 認可コード) / `state` (CSRF state) / `apikey` の **値だけ** 伏字化 (key=value 形式は維持)
  - **request body** (`event.request?.data`): string body は全体 `[Filtered]`、object body は再帰 walk で `password` / token 系 key の値を伏字化、16 KB 超 / 再帰深度 8 超は body 全体 `[Filtered]`
  - **breadcrumbs** (fetch / xhr): URL と headers にも同じ scrub を適用
  - **user 情報** (`event.user.email` / `username` / `ip_address`): `sendDefaultPii: false` の二重防御で明示削除
- scrub 中の例外は `try { ... } catch { console.warn(...) }` で吸収し、元の event は捨てずに Sentry へ送出 (届くことを優先する fail-open 設計)
- `release` を Cloudflare Workers の Version Metadata Binding (`env.CF_VERSION_METADATA?.id`) から取得、未設定時は `"unknown"`
- `environment` を `env.NEXT_PUBLIC_SUPABASE_ENV === "staging" ? "staging" : "production"` で判定 (Runtime セクション登録に依存)
- `sendDefaultPii: false` を明示 (SDK default も false だが設定変更ミス検知のため)
- `tracesSampleRate: 0.1` は Plan A から維持 (Free tier 枠保護)

#### Cloudflare ダッシュボード前提 (運用)
- Variables and Secrets (**Runtime**) に `SENTRY_DSN` 登録
- Variables and Secrets (**Runtime**) に `NEXT_PUBLIC_SUPABASE_ENV=staging` を dev preview build 側に登録 (本番側は未設定で OK)
- `wrangler.jsonc` の `version_metadata.binding = "CF_VERSION_METADATA"` 経由で deploy ごとの release が自動付与

### 2.2 B-2: OG ルートのフォント自前 + cache / error fallback

#### 背景
`src/app/api/og/[id]/route.tsx` の `getFontFromGoogle()` は毎リクエスト Google Fonts に CSS + TTF を fetch しており、SNS bot バースト時の SPOF だった。`FONT_CACHE` は module-scope のみ。`shares.image_url` が `null` の share / sanitize で弾かれた share に対する `next/og` 動的生成が SPOF を踏むと SNS プレビューが全壊する。

#### 変更ファイル
- `src/app/api/og/[id]/route.tsx` (全面リファクタ)
- `src/lib/og/fonts.ts` (新規、ASSETS binding 経由 + module cache)
- `src/lib/og/fonts.test.ts` (新規、5 ケース)
- `public/fonts/NotoSansJP-Regular.ttf` / `public/fonts/NotoSansJP-Bold.ttf` (新規、Google Fonts v56 subset)
- `public/og-default.png` (新規、1200×630 fallback)
- `scripts/build-og-default.mjs` (新規、sharp で生成)
- `src/assets/fonts/NotoSansJP-Bold.ttf` (削除、`public/fonts/` に統合)

#### 実装ポイント
- フォントは ASSETS binding 経由 (`getCloudflareContext().env.ASSETS.fetch(new URL("/fonts/NotoSansJP-...ttf", "http://placeholder.invalid"))`) で取得、module-scope cache (`FONT_CACHE`) で同 isolate 内の再フェッチを回避
- 取得失敗時は空配列 (フォント無し render) にフォールバック (壊れた SNS プレビューを出すよりは「OS デフォルトに崩れた画像」を出す方が好ましい)
- Workers Cache API (`globalThis.caches?.default`) を二段防御で導入:
  - **環境フォールバック**: `caches` 不在 (ローカル `next dev` / Node テスト) は cache 層全体 skip
  - **検証ヘッダ**: 独自 `X-Tierlog-OG-Cache: HIT | MISS` を付与 (Cloudflare の `cf-cache-status` は別レイヤなので使わず)
  - **cache.match / cache.put のいかなる失敗も normal フローへ落ちる** 設計 (cache 失敗 → og-default fallback ではなく Storage redirect / ImageResponse 生成へ進ませる)
  - **cache.put waitUntil の rejection** は `.catch(e => console.warn(...))` を chain してから `waitUntil` に渡す (Worker の unhandled rejection 防止、RD-B10 + Codex 第 7 回 P3 #1)
  - **headers immutable** な ImageResponse / cached Response への対応: `new Response(body, init)` で wrap してから set
- outer `try / catch` は `renderOgResponse` 内部例外 (ImageResponse 等) のみカバー、最終 fallback は `Response.redirect(${origin}/og-default.png, 302)`
- `public/og-default.png` は 1200×630 PNG (sharp で SVG gradient + ブランドマーク center 配置 + Tierlog テキストを合成)

#### Plan A 共存
- Plan A の `sanitizeShareImageUrl` / `normalizeSupabaseStoragePrefix` / `loadStoragePublicUrlPrefix` (`app_settings.storage_public_url_prefix` を一次正、env 由来 prefix を二次 fallback) は変更なし
- 二段防御 (DB trigger `is_safe_share_image_url` + display sanitizer) は維持、Plan B が追加するのは第三段の最終 fallback `og-default.png` のみ

### 2.3 B-3: noindex header / metadata 整備

#### 背景
- `/admin` / `/account` / `/api` / `/auth` は `robots.txt` Disallow だけで外部リンク経由 index を防げない
- `/dm/*` / `/pokepoke/*` は現状 `robots.ts` の Disallow に含まれず、中間 HTML がクロールされうる
- dev preview (`*.workers.dev`) が本番と同じ index/follow 設定で重複コンテンツ index リスク
- 公開法務ページ (`/terms` / `/privacy` / `/contact`) が `"use client"` で metadata 不在 (AdSense 申請で original content / canonical 必要)

#### 変更ファイル
- `next.config.ts` (security header は維持、X-Robots-Tag entries は撤去)
- `src/sentry-worker.ts` (per-host / per-path で X-Robots-Tag 強制設定する `wrappedFetch` を Sentry.withSentry の handler として注入)
- `src/app/layout.tsx` (root `metadata.robots` を build env で switch)
- `src/app/dm/layout.tsx` / `src/app/pokepoke/layout.tsx` (server layout に `metadata.robots` 追加)
- `src/app/share/[id]/page.tsx` (`generateMetadata` に `robots` 追加)
- `src/app/terms/page.tsx` / `src/app/privacy/page.tsx` / `src/app/contact/page.tsx` (server wrapper 化 + 固有 metadata)
- `src/app/terms/TermsClient.tsx` / `src/app/privacy/PrivacyClient.tsx` / `src/app/contact/ContactClient.tsx` (client core 新規)

#### 実装ポイント (Cloudflare の X-Robots-Tag 切詰め事象への対応)
dev preview 実測で `response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive")` の comma-separated 値が **Cloudflare 経路で `noindex` のみに切り詰められる事象**を観測 (独自 `X-Tierlog-Robots` header では完全な値が通過したため Cloudflare 特定の rewrite と判定)。本番の HTTP/2 では `noindex` + `nofollow` の 2 行 multi-header field として伝送される一方、`noarchive` が抜ける。

対応として **header と meta の二段運用**:
- **X-Robots-Tag header** (`src/sentry-worker.ts` の `wrappedFetch`):
  - per-host / per-path で値を resolve し、`response.headers.delete` + `append` で複数 header field を構築
  - dev preview (`dev-duepure-tracker.jianrenzhongtian7.workers.dev`) は全 path に `noindex, nofollow, noarchive` 相当を append
  - `/auth*`: `noindex, nofollow, noarchive`
  - `/admin*` / `/account*` / `/dm/*` / `/pokepoke/*`: `noindex, nofollow` (dev preview は `noindex, nofollow, noarchive`)
  - `/api/*`: `noindex` のみ (content-type が JSON 等で meta 解釈不可のため header 必須)
  - 本番 `/` / `/terms` / `/privacy` / `/contact` / `/share/*` には header を付けない
- **`<meta name="robots">`** (SSR HTML 内、Next.js metadata API):
  - `src/app/layout.tsx`: build env (`NEXT_PUBLIC_SUPABASE_ENV`) で switch、dev preview = `noindex, nofollow, noarchive` / 本番 = undefined (meta 不在 = default index)
  - `src/app/dm/layout.tsx` / `src/app/pokepoke/layout.tsx`: 本番 = `noindex, nofollow` / dev preview = `noindex, nofollow, noarchive`
  - `src/app/share/[id]/page.tsx`: 本番 = `{ index: false, follow: true }` (RD-B5、内部リンクのクロール許容) / dev preview = `{ index: false, follow: false, noarchive: true }` (RD-B1 / Codex 第 7 回 P3 #2)

#### 公開法務 3 page の server wrapper + client core 化
- `page.tsx` を server component に変更し `export const metadata: Metadata = { title, description, alternates: { canonical: "/{path}" }, openGraph: { ... } }` を export
- 既存の `"use client"` ロジック (`useRouter().back()` 戻るボタン等) を `*Client.tsx` に分離し `page.tsx` から `import` で組み込み
- `/auth` / `/admin` / `/account` の client page 分割は **行わない** (RD-B2、Plan A の game/next 引き継ぎ修正に対する regression リスク回避)

### 2.4 B-4: 公開ランディング + sitemap + BanGuard 修正

#### 変更ファイル
- `src/app/page.tsx` (cookie 依存 `permanentRedirect` → SSR ランディング)
- `src/components/landing/LandingHero.tsx` (新規)
- `src/app/sitemap.ts` (整理)
- `src/components/providers/BanGuard.tsx` (`EXCLUDED_PATHS` 判定ロジックを拡張)

#### 実装ポイント
- root を SSR で公開ランディング化: ブランドヒーロー + 4 特徴 + 対応ゲーム 2 件 + フッター。`metadata.title` / `description` / `alternates.canonical: "/"` / OGP / Twitter Card 完備
- ログイン済ユーザー向けには **目立つ「アプリを開く」CTA** を header / hero / 対応ゲーム card に配置 (`/{defaultGame}/home` へ 1 クリック遷移)。BanGuard で認証チェック → 未認証なら `/auth` redirect
- cookie の `selectedGame` を SSR で読み、`defaultGame` を `dm` (default) または保存済値で resolve
- sitemap から `/{slug}/home` を削除し `/`, `/privacy`, `/terms`, `/contact` のみに整理。Google bot がログイン画面に到達するのを回避
- BanGuard の `EXCLUDED_PATHS` 判定を `EXACT_PUBLIC_PATHS = ["/"]` + `PUBLIC_PREFIXES = ["/auth", "/terms", "/privacy", "/contact", "/share"]` の二段判定に拡張 (RD-B8):
  - root `/` は exact match で除外 (`startsWith("/")` で全 path bypass する事故を回避)
  - 既存 prefix は `pathname === p || pathname.startsWith(${p}/)` で判定
- Plan A の retry + fail-open + anonymous redirect + `stage === 4` BAN 画面ロジックは **そのまま維持**

### 2.5 B-5: Observability runbook

- `docs/runbooks/observability-overview.md`: 観測責任分界表 (Sentry / Cloudflare Web Analytics / Cloudflare Workers Logs / Supabase Logs / Supabase Auth Logs / Storage Logs)、保持期間、Free tier 上限、各層へのイベント送信ガイド、トラブルシュート
- `docs/runbooks/sentry-runbook.md`: DSN 設定 (Runtime セクション必須)、scrubber 設計、release / environment 連携、test event 手順、4 種のトラブルシュート (DSN 不在 / environment 誤分離 / release unknown / 機微情報漏れ)
- `CLAUDE.md` / `AGENTS.md` は最小限のリンクのみ (一次正は runbook 側)

### 2.6 B-6: 法務 gap analysis

- `docs/reports/2026-05-27_legal_gap_analysis.md` 新規
- 一般公開段階 (無料公開) は現状の `/terms` / `/privacy` / `/contact` で OK と確認
- AdSense 申請段階で必要な追加項目 (ads.txt / 第三者広告 / Cookie consent 記載)、Stripe サブスク導入段階で必要な項目 (特商法表記 / 自動更新条項 / 決済情報取得記載)、海外展開時の GDPR / CCPA 対応をリストアップ
- 実装は **Phase 3 法務 plan** で扱う (本 plan では文書のみ)

---

## 3. Codex 指摘の反映履歴

### 3.1 plan 確定までの Codex 5 周 (`plan-critic` 12 反復併用)
plan ファイル (`docs/plans/2026-05-27_plan_b_observability_og_seo.md`) の Codex Review Feedback セクションに記録済。第 5 回時点で「設計変更ゼロ、新規 RD なし」となり完成版に到達。

### 3.2 Codex 第 6 回 (dev preview 実測指摘、`64ca256` + `3b0ec00` + `4a541fa` + `5b2f25c`)

dev push 後の dev preview 実測で 4 点の修正対応:

| # | 指摘 | 反映 |
|---|---|---|
| 1 | `/api/og/<valid share id>` が `og-default.png` に fallback している | `tryGetCachedResponse` / `tryPutCacheResponse` helper に分離し、cache.match / cache.put / headers.set のいずれの失敗も outer catch に届かず normal フローへ進む設計に変更。outer try/catch は `renderOgResponse` 内部例外のみ覆う |
| 2 | X-Robots-Tag が `noindex` のみで `nofollow`/`noarchive` が落ちる | comma-separated 値が Cloudflare 経路で切り詰められる事象と判定。`<meta name="robots">` 経由で SSR HTML に補完する設計に切替 (root `layout.tsx` を build env で switch、`dm/layout.tsx` / `pokepoke/layout.tsx` の server layout に robots 追加)。本番 root は `metadata.robots: undefined` でヘッダ・meta いずれも不在 |
| 3 | `sitemap.xml` / `robots.txt` の URL に改行混入 | `getNormalizedBaseUrl()` (`trim()` + `replace(/\/+$/, "")`) を `sitemap.ts` / `robots.ts` の両方に追加 |
| 4 | `og-default.png` が 1024×1024 で metadata 宣言 (1200×630) と不一致 | `scripts/build-og-default.mjs` で sharp 経由 1200×630 PNG を生成し差し替え |

### 3.3 Codex 第 7 回 (P3 2 件、`ea71278`)

| # | 指摘 | 反映 |
|---|---|---|
| P3 #1 | `cache.put()` の rejection を `ctx.waitUntil` に渡すと `try/catch` で拾えず Worker の unhandled rejection になる | `cache.put(...).catch(e => console.warn("OG cache put failed:", e))` を chain してから `waitUntil` に渡す形に変更。`waitUntil` 不在経路は同期 `await` + `try/catch` を維持 (RD-B10 「console.warn only」方針と整合) |
| P3 #2 | dev preview の `/share/[id]` が RD-B1 (dev preview 全体 noindex/nofollow/noarchive) の例外になっている | `share/[id]/page.tsx` の `generateMetadata.robots` を build env で switch。本番は RD-B5 のまま `{ index: false, follow: true }`、staging build のみ `{ index: false, follow: false, noarchive: true }` |

---

## 4. dev preview 検証結果

dev preview (`https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/`) で以下を確認:

| 確認項目 | 結果 |
|---|---|
| `npx tsc --noEmit` | clean ✅ |
| `npm run lint` (Plan B touch 範囲) | warning なし ✅ (既存 25 errors は Plan A §7.1 既知事象、Plan B 範囲外) |
| `npm test -- --run` | 8 files / **149 tests passed** (前回 144 + `fonts.test.ts` 5 件) ✅ |
| `npx opennextjs-cloudflare build` | OpenNext build complete ✅ |
| dev preview `/` X-Robots-Tag + `<meta robots>` | header `noindex` + meta `noindex, nofollow, noarchive` ✅ |
| dev preview `/dm/home` / `/pokepoke/home` | 同上 ✅ |
| dev preview `/auth` | 同上 ✅ |
| dev preview `/share/<share_id>` | header `noindex` + meta `noindex, nofollow, noarchive` (P3 #2 反映後) ✅ |
| dev preview `/api/og/<share_id>` (staging share) | `HTTP/2 302` + staging Storage URL ✅ (P3 #1 反映後も regression なし) |
| dev preview `/sitemap.xml` / `/robots.txt` raw bytes | `<loc>` 内に改行混入なし、Sitemap URL も改行なし ✅ |
| dev preview `/og-default.png` | `PNG image data, 1200 x 630, 8-bit/color RGBA, non-interlaced` ✅ |
| dev preview `/terms` / `/privacy` / `/contact` | 200 + 固有 title + 固有 description + canonical ✅ |

---

## 5. 本番反映 commit

```
49ccd54 Merge branch 'dev'    ← main HEAD
```

merge 内訳:
```
ea71278 fix(plan-b): Codex 第 7 回 P3 2 件を反映
5b2f25c fix(plan-b): 本番 root の metadata.robots を undefined に変更
4a541fa fix(plan-b): X-Robots-Tag CDN 切詰めを <meta robots> 経由で補完
3b0ec00 fix(plan-b): X-Robots-Tag を multi-value append 形式に変更
64ca256 fix(plan-b): Codex 第 6 回 dev preview 実測指摘 4 件を反映
5213ae3 feat(plan-b): Observability / OG / SEO 一式 (B-1〜B-6)
```

本番反映フロー:
1. `git checkout main && git pull origin main`
2. `git merge dev` (ort strategy、競合なし)
3. `git push origin main` → Cloudflare 本番 deploy 自動起動
4. Cloudflare Workers Builds: `completed / success` (GitHub Checks 確認)
5. 本番 smoke check (§6)
6. 本番 `/api/og/<share_id>` 実機確認 (§7)
7. `git checkout dev` で dev branch に戻し

DB migration なし、外部サービス dashboard 操作なし。

---

## 6. 本番 smoke check 結果

`https://tierlog.app` への `curl` で確認:

| # | 確認項目 | 結果 |
|---|---|---|
| 1 | `/` が SSR ランディングとして 200 | ✅ `HTTP/2 200` + `content-type: text/html; charset=utf-8` |
| 2 | 本番 `/` に X-Robots-Tag と robots meta が **付いていない** | ✅ `X-Robots-Tag` 不在 + `<meta name="robots">` count: 0 (`IS_STAGING_BUILD=false` で `metadata.robots: undefined` → default index) |
| 3 | `/dm/home` / `/pokepoke/home` が X-Robots-Tag: `noindex` + meta `noindex, nofollow` | ✅ 両方 `x-robots-tag: noindex` + `x-robots-tag: nofollow` (HTTP/2 multi-header field) + `<meta name="robots" content="noindex, nofollow">` |
| 4 | `/share/<share_id>` が本番では meta `noindex, follow` | ✅ `<meta name="robots" content="noindex">` (Next.js が `follow: true` を default 省略する仕様、RD-B5 `noindex / follow` 意図と等価) |
| 5 | `/api/og/<share_id>` が Storage public URL へ 302 | ✅ §7 で確認 |
| 6 | `/sitemap.xml` と `/robots.txt` の URL に改行混入なし | ✅ raw bytes (`od -c`) で `<loc>https://tierlog.app/...</loc>` がきれいに連結、Sitemap URL も改行なし |
| 7 | `/og-default.png` が 1200×630 | ✅ `PNG image data, 1200 x 630, 8-bit/color RGBA, non-interlaced` (本番 download 検証) |
| 8 | `/terms` / `/privacy` / `/contact` が 200 で固有 metadata | ✅ 全 3 page が 200、固有 `<title>` (「利用規約 / プライバシーポリシー / お問い合わせ \| Tierlog」)、固有 `<meta name="description">`、固有 `<link rel="canonical" href="https://tierlog.app/{path}">` |

---

## 7. 本番 `/api/og/<share_id>` 実機確認結果

ユーザー作成の本番 share id (本報告書では `<share_id>` でマスク) で確認:

```
$ curl -sI "https://tierlog.app/api/og/<share_id>"
HTTP/2 302
location: https://<prod-supabase-ref>.supabase.co/storage/v1/object/public/share-images/<user_id>/<share_id>.png
```

| 確認項目 | 結果 |
|---|---|
| `curl -sI .../api/og/<share_id>` | `HTTP/2 302` ✅ |
| `location` ヘッダ | `https://<prod-supabase-ref>.supabase.co/storage/v1/object/public/share-images/<user_id>/<share_id>.png` ✅ (production Supabase project ref + `share-images/<user_id>/<share_id>.png` 形式) |
| `/share/<share_id>` の `og:image` | 同一 Storage URL ✅ |
| `/share/<share_id>` の `twitter:image` | 同一 Storage URL ✅ |

Plan A の display sanitizer (`sanitizeShareImageUrl` + `loadStoragePublicUrlPrefix` 一次正、env 二次 fallback) と Plan B の OG cache 層分離 (cache 失敗時の `og-default.png` fallback 回避) が本番でも正常動作することを確認。

---

## 8. 残スコープ / Phase 2 / Phase 3

### 8.1 Plan B 本体スコープ外で次の plan に送る項目

- **Plan C: Multi-Game DB Scope** — `get_team_member_summaries` / detection / quality scoring の game scope 拡張
- **Plan D: Access Gate / Auth Expiry** — ban / suspended / unpaid の DB / RLS / API access gate 強制、`getUser()` 用途整理、middleware session refresh、`if (!user) return []` 統一。Plan B B-4-e の BanGuard 修正 (root 公開除外) は表層対応で、Plan D が再設計する想定
- **Plan E (Phase 2)** — 初回オンボーディング / `recharts` lazy load / Discord refresh token / `npm test` 復旧

### 8.2 Phase 2 で扱う項目 (Plan B 内で明示的に後回し)

- B-2 期限切れ share の OG cache invalidation
- B-2 フォント subset 化 (現在 NotoSansJP full set 約 10MB、subset で約 1〜2MB に削減可能)
- B-3 アプリ内部 `/dm/*` / `/pokepoke/*` の per-page metadata 精緻化 (title / canonical / OGP の page 単位整備)
- B-4 ランディング素材差し替え (現在 placeholder)
- B-4 ランディング多言語化 (海外展開時)
- B-5 client / browser 側 Sentry の導入 (現状は Cloudflare Workers のみ)

### 8.3 Phase 3 で扱う項目 (B-6 法務 gap analysis の入力に基づく)

- **AdSense 申請**: ads.txt 追加、privacy への第三者広告記載、original content 補強
- **Stripe サブスク導入**: 特商法に基づく表記ページ (`/specified-commercial-transactions`)、terms 有料プラン条項、privacy 決済情報取得記載、Customer Portal 連携、自動更新事前告知
- **海外展開 (GDPR / CCPA)**: Cookie consent UI、英語版法務ページ、データポータビリティ請求対応、同意撤回 UI

---

## 9. Plan A 非破壊確認

Plan A 完了済の 4 件が Plan B 実装後も動作することを確認:

| Plan A の機能 | Plan B 後の状態 |
|---|---|
| A-1 `shares.image_url` 二段防御 (DB trigger + display sanitizer) | ✅ 維持。Plan B B-2 で第三段の最終 fallback `og-default.png` を追加したのみ。`sanitizeShareImageUrl` / `normalizeSupabaseStoragePrefix` / `loadStoragePublicUrlPrefix` は改変なし。任意外部 URL を許可する方向への後退なし |
| A-2 legacy URL / `<HomeLink />` / `loading.tsx` / `global-error.tsx` / 文字化け修正 | ✅ 維持。Plan B では `src/middleware.ts:6` の `LEGACY_ROOTS = ["/home", "/battle", "/decks", "/stats"]` を含む既存 redirect 定義を touch せず |
| A-3 BanGuard retry + 最終 fail-open + `LoadingSpinner` | ✅ 維持。Plan B B-4-e は `EXCLUDED_PATHS` 判定ロジックの **拡張のみ** (exact + prefix 二段判定で root だけを公開除外)、retry / fail-open / anonymous redirect / `stage === 4` BAN 画面ロジックは改変なし |
| A-4 共有 / 未ログイン導線で `game` / `next` 引き継ぎ + `isSafeInternalPath` open redirect 防御 | ✅ 維持。Plan B では `src/app/auth/page.tsx` の `useSearchParams` / `signInWithOAuth` / email/password 経路の `resolvedTarget` 共有を touch せず、`src/app/auth/callback/page.tsx` の SIGNED_IN 処理も touch せず。`src/lib/auth/redirect.ts` の `isSafeInternalPath` / `resolveAuthRedirectTarget` も改変なし |

その他の禁止事項遵守:
- `getUser()` を `getSession()` に一括置換せず (CLAUDE.md 厳守)
- `auth/callback/page.tsx` の既存 SIGNED_IN 処理は変更なし
- `middleware.ts` は touch せず
- URL ハードコード禁止: 全て `process.env.NEXT_PUBLIC_APP_URL` か `window.location.origin` 経由
- ランタイム Secret は `getServerEnv()` 経由 (Plan B では `SUPABASE_SERVICE_ROLE_KEY` を従来通り `getServerEnv` で取得)
- `main` への直接 push せず、必ず `dev` 経由
- production DB 変更なし (Plan B はコードと assets のみ)
- 外部サービス dashboard 操作なし (Runtime 変数登録は Plan A 完了時点ですでに完了済、追加登録は不要)

---

## 10. 関連リンク

### plan / report
- plan: `docs/plans/2026-05-27_plan_b_observability_og_seo.md`
- 元 audit: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` (Claude Code 版: `2026-05-26_claude_code_pre_public_monetization_audit.md`, Codex 版: `2026-05-27_codex_pre_public_monetization_audit.md`)
- Plan A 完了報告: `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md`
- 本 plan B-6 成果物: `docs/reports/2026-05-27_legal_gap_analysis.md`

### runbook (本 plan B-5 で新規)
- `docs/runbooks/observability-overview.md` — 観測責任分界表 + 各層へのイベント送信ガイド + トラブルシュート
- `docs/runbooks/sentry-runbook.md` — DSN / scrubber / release / environment / 実機確認手順 / 4 種のトラブルシュート
- 既存: `docs/runbooks/cloudflare-rollback.md`, `database-backup-restore.md`, `incident-communication-template.md`, `monitoring-alert-handling.md`, `staging-data-sync.md`, `supabase-incident-response.md`

### 関連 commit (本番反映済)
- `49ccd54 Merge branch 'dev'` (main 反映)
- `ea71278 fix(plan-b): Codex 第 7 回 P3 2 件を反映`
- `5b2f25c fix(plan-b): 本番 root の metadata.robots を undefined に変更`
- `4a541fa fix(plan-b): X-Robots-Tag CDN 切詰めを <meta robots> 経由で補完`
- `3b0ec00 fix(plan-b): X-Robots-Tag を multi-value append 形式に変更`
- `64ca256 fix(plan-b): Codex 第 6 回 dev preview 実測指摘 4 件を反映`
- `5213ae3 feat(plan-b): Observability / OG / SEO 一式 (B-1〜B-6)`

### 公式 docs (実装時参照)
- Sentry Cloudflare SDK: <https://docs.sentry.io/platforms/javascript/guides/cloudflare/>
- Sentry Configuration Options: <https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/options/>
- Cloudflare Workers Version Metadata Binding: <https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/>
- OpenNext Custom Worker pattern: <https://opennext.js.org/cloudflare/howtos/custom-worker>

---

## 11. まとめ

Plan B は一般公開前の Observability / OG / SEO ブロッカー 6 件 (B-1 〜 B-6) を解消するコード + assets + 文書化として、plan-critic 12 反復 + Codex 5 周 (plan 確定) + Codex 第 6 回 (dev preview 実測 4 件) + Codex 第 7 回 (P3 2 件) を経て、本番 smoke check 8 項目 + `/api/og/<share_id>` 実機確認まで完走した。

Plan A 完了済の 4 件 (`shares.image_url` 二段防御 / auth `game`/`next` 引き継ぎ / BanGuard fail-open + retry / legacy URL) は非破壊で維持。auth / middleware / `getUser()` の禁止事項を遵守。任意外部 `image_url` を許容する方向への後退なし。

Cloudflare 経路で X-Robots-Tag の comma-separated 値が切り詰められる事象を発見し、`<meta name="robots">` 二段運用で補完する設計に切替済。Workers Cache 失敗時の og-default fallback 暴発も解消し、valid share の Storage redirect が壊れないことを本番実機で確認した。

残スコープ (Plan C / Plan D / Plan E / Phase 3) は別 plan で扱う。
