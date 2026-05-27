# 実装報告書: Plan A 一般公開前安全対応（A-1〜A-4）本番反映完了

- 報告日: 2026-05-27
- 対象 plan: `docs/plans/2026-05-27_plan_a_public_launch_safety.md`
- 対象レビュー: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` §7 Plan A (Public Launch Safety)
- ステータス: **本番反映 + production DB migration 適用 + 本番実機確認まで完了**
- 関連 commit:
  - `f7d0f17 feat(safety): Plan A 一般公開前安全対応一式 (A-1〜A-4)`
  - `65c2ac7 fix(plan-a): Codex 第 3 回指摘の 2 件反映`
  - `ef9daaf fix(plan-a): share 画像 sanitizer の env prefix ズレを解消 (#A-1 regression)`
  - `b151d17 Merge branch 'dev'`（main 反映）
- 関連 migration: `supabase/migrations/20260527000001_shares_image_url_storage_only.sql`
- 関連 rollback: `supabase/rollback/20260527000001_rollback.sql`

---

## 1. サマリ

統合 audit (`docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md`) で抽出された一般公開ブロッカーのうち、UI / route 中心かつ即時対応が必要な 4 件（P0 1 件 + P1 3 件）を Plan A として実装し、本番（`https://tierlog.app`）まで反映を完了した。

- **A-1**（P0）: `shares.image_url` 任意外部 URL の DB / display 二段防御（`is_safe_share_image_url` trigger + display-time sanitizer）
- **A-2**（P1）: legacy URL / game slug なし遷移の解消、`<HomeLink />` 共通化、`loading.tsx` / `global-error.tsx` 新設、`account/page.tsx` 文字化け修正
- **A-3**（P1）: `BanGuard` 白画面の解消（リトライ + 最終 fail-open、`LoadingSpinner` 表示）
- **A-4**（P1）: 共有 / 未ログイン導線で `game` / `next` を引き継ぎ、`isSafeInternalPath` で open redirect を防御

実装は plan-critic 6 反復で GO 判定 + Codex 3 周レビュー反映を経た plan に従って実施。dev preview 反映後に Codex 実機レビューで 2 件の追加修正、その後 dev preview の実機確認で X 投稿の画像表示が `/api/og` fallback に倒れる回帰を検出して 1 件の追加修正を実施。最終的に dev → staging DB migration → main 反映 → production DB migration → 本番実機検証まで OK で着地した。

任意外部 URL を許可する方向へ後退せず、plan §A-1 RD-2「DB trigger（write-time）+ display sanitizer（read-time）の二段防御」「既存行は display sanitizer で防ぎ、新規 INSERT/UPDATE のみ trigger で write-time 拒否」の方針を本番まで維持している。

---

## 2. 実装内容

### 2.1 A-1: `shares.image_url` 任意外部 URL の拒否

#### 設計（plan §A-1 + RD-1 / RD-2）

外部 URL を `shares.image_url` に保存すると `/api/og/[id]` が `Response.redirect(external_url, 302)` で任意ホストへリダイレクトし、悪意ある画像追跡 / 詐称 OG に悪用されうる。これを **DB trigger（write-time）と display sanitizer（read-time）の二段防御** で塞いだ。

#### DB 層（migration `20260527000001_shares_image_url_storage_only.sql`）

- `public.app_settings` に `key='storage_public_url_prefix'` を新設（既存 key-value テーブルを再利用、schema 変更なし）。値は `"https://<project-ref>.supabase.co/storage/v1/object/public/share-images/"` の jsonb scalar string（末尾 slash 必須）。
- `validate_app_settings` trigger に `storage_public_url_prefix` 検証分岐を追加（jsonb string 型 / `https://` で始まる / `/storage/v1/object/public/share-images/` で終わる）。
- `public.is_safe_share_image_url(p_image_url text, p_user_id uuid) RETURNS boolean` を `SECURITY DEFINER` + `SET search_path = ''` + `pg_catalog.*` 完全修飾で実装。`app_settings` から prefix を取得し、prefix 一致 / 1 階層目 user_id 完全一致 / query / fragment なし を検証。**prefix 未設定時は fail-closed で `RAISE EXCEPTION 'storage_public_url_prefix not configured'`**。
- `shares_validate_image_url_trigger()` を `BEFORE INSERT OR UPDATE OF image_url, user_id ON public.shares` で発火（Codex 第 3 回指摘 2 対応方針 B、後述）。`image_url`/`user_id` を書き換えない UPDATE（例: 既存の `recalc_shares_expires_at_on_retention_change` が retention 変更時に発火する `UPDATE shares SET expires_at = ...`）では trigger が走らないため、既存外部 URL 行が残っていても retention 設定変更等の運用 UPDATE が失敗しない。
- 既存 prefix 行への no-op UPDATE (`UPDATE public.app_settings SET value = value WHERE key = 'storage_public_url_prefix'`) で新 validation 分岐を強制再評価。
- 行 missing 検出: migration 末尾の `DO $$ ... IF NOT EXISTS ... RAISE EXCEPTION ... END $$;` で `storage_public_url_prefix` 行不在時は migration 自体を abort。
- rollback SQL を `supabase/rollback/20260527000001_rollback.sql` に同梱（trigger / helper / function を削除し、`validate_app_settings` を 20260515000001 時点に戻す）。

#### display 層（`src/lib/share/image-url.ts` + 呼び出し側）

- `sanitizeShareImageUrl(imageUrl, { allowedPrefix | allowedPrefixes, shareUserId })`: imageUrl が `null` ならそのまま `null`（OG fallback）、prefix 一致 + 1 階層目が `shareUserId` 完全一致 + query / fragment なしならその URL を返却、それ以外は `null`。`allowedPrefix` 単数と `allowedPrefixes` 複数の **両対応**（regression fix 後、後述）。
- `normalizeSupabaseStoragePrefix(supabaseUrl)`: 入力の trailing slash を 1〜複数まとめて剥がして `${url}/storage/v1/object/public/share-images/` を返却。
- `src/app/share/[id]/page.tsx` と `src/app/api/og/[id]/route.tsx`:
  - SELECT 列に `user_id` を追加（既存 `share_type, share_data, image_url, game_title` に併記）。
  - 同じ supabase client で `app_settings.storage_public_url_prefix` も読む（`loadStoragePublicUrlPrefix`）。これを **一次正**、`normalizeSupabaseStoragePrefix(process.env.NEXT_PUBLIC_SUPABASE_URL)` を **二次 fallback** として `allowedPrefixes` 配列で sanitizer に渡す。
  - production code deploy → production migration 適用前の時間帯では DB 行不在で env fallback が効くため、display sanitizer は code-first deploy でも壊れない。

#### unit test（`src/lib/share/image-url.test.ts` 24 ケース）

- 基本: null / 正規 URL / 別 user_id / 外部 URL / protocol-relative / query / fragment / prefix のみ / dir のみ / 部分一致 / nested path
- 拡張: `allowedPrefixes` 複数候補マッチ / 不一致 / null・空エントリ無視 / 空配列拒否
- `normalizeSupabaseStoragePrefix`: clean URL / trailing slash 1 個 / 多重 trailing slash / null・空・非文字列
- **回帰**: trailing slash 付き `NEXT_PUBLIC_SUPABASE_URL` でも safe URL が弾かれない統合テスト 2 件

### 2.2 A-2: legacy URL / 文字化け / `loading.tsx` / `global-error.tsx`

#### 設計（plan §A-2 + RD-3）

旧 routing（`/home` `/battle` `/decks` `/stats`）への `<Link>` / `router.push` 残置を一掃し、現在の game slug（`dm` / `pokepoke`）に応じた `/{game}/...` パスへ統一。404 / error / loading の SSR fallback を整備。

#### 新規ファイル

- `src/components/layout/HomeLink.tsx`（client component）: `usePathname()` 優先で先頭 segment が `dm` / `pokepoke` 等の場合はその slug、それ以外は `useSelectedGame()` の `game`（`ready` 待ち中は disabled spinner）で `/{game}/home` を生成。
- `src/components/layout/LoadingSpinner.tsx`: A-2 / A-3 共通の軽量 spinner。
- `src/app/loading.tsx`: navigation suspense fallback。`TierlogLogo` + spinner。
- `src/app/global-error.tsx`: root layout が throw した時の最終 fallback。Next.js 規約に従い `<html><body>` を独自に持ち、inline style 最小限。

#### 既存ファイル修正

- `src/app/error.tsx`, `src/app/not-found.tsx`: `<Link href="/home">` → `<HomeLink />`。
- `src/app/dm/home/page.tsx`, `src/app/pokepoke/home/page.tsx`: チームメンバー tap の `router.push('/stats?scope=team&member=...')` を game-scoped に。
- `src/components/stats/MyDeckStatsSection.tsx`, `OpponentDeckStatsSection.tsx`: stats 詳細遷移を `/${game}/stats/(deck|opponent)/...` へ。
- `src/app/account/page.tsx`: 「ユーザー名の更新に失敗しました」の U+FFFD 文字化けを修正。

#### 残置の妥当性

- `src/components/layout/BottomNav.tsx:18` の `suffix: "/home"` は「現在の game slug + /home」を組み立てる suffix として使用、legacy 直書きではない。
- `src/middleware.ts:6` の `LEGACY_ROOTS = ["/home", "/battle", "/decks", "/stats"]` は古いブックマーク救済のための 308 redirect 定義として残置。

### 2.3 A-3: BanGuard 白画面解消

#### 設計（plan §A-3 + RD-4）

`supabase.auth.getUser()` / `getUserStage()` が reject した場合に `isBanned === null` のまま `return null` で全画面が空白になる現象を解消。**ban 強制は Plan D の DB/RLS/API access gate で別途担保する責務分離** を明示。

#### 実装（`src/components/providers/BanGuard.tsx`）

- `RETRY_DELAYS_MS = [300, 800]`: 300ms → 800ms の 2 段 backoff リトライ。`AbortController` で unmount 時 cancel。
- 成功時: 従来通り `setIsBanned(stage === 4)`。
- リトライ全敗時: `console.error("BanGuard auth/stage failed after retries:", lastError)` + `setIsBanned(false)`（**最終 fail-open**、Supabase 一時障害で全ユーザー閉塞を避けるため）。
- 既存挙動の維持: `user` なし / `user.is_anonymous` → `/auth` redirect + signOut。`stage === 4` → BAN 画面。
- `isBanned === null` 中は `<LoadingSpinner />` を表示（従来の `return null` を置換）。
- `getUser()` を `getSession()` に置き換える操作は **行わず**（CLAUDE.md 厳守事項）。

### 2.4 A-4: 共有 / 未ログイン導線で `game` / `next` を引き継ぐ

#### 設計（plan §A-4 + Codex review 1〜最終）

- 共有 URL から「ログイン / 新規登録」をタップしてもログイン後の着地点が `/dm/battle` 固定で、`pokepoke` 流入や share 戻り経路が壊れていた現象を解消。
- OAuth provider 経由の callback URL にも `game` / `next` が保持され、callback 側でも再検証する。
- email/password 経路（onAuthStateChange SIGNED_IN / signInWithPassword / signUp の 3 経路）でも同じ `resolvedTarget` を使う。
- `next` パラメータの open redirect 防止を厳格化（decode 前後検証 / protocol-relative / scheme / backslash / 制御文字 / `/auth`・`/api` 配下 / malformed percent encoding を全て拒否）。

#### 新規ファイル（`src/lib/auth/redirect.ts` + test 19 ケース）

- `type ReadOnlySearchParamsLike = { get(name: string): string | null }`: `URLSearchParams`（DOM）と `useSearchParams()` の `ReadonlyURLSearchParams`（Next.js）の両方を構造的サブタイピングで受ける最小 interface。
- `isSafeInternalPath(next)`: 1〜512 文字 / `decodeURIComponent` 通過 / 先頭 `/` かつ `//` で始まらない / backslash なし / 制御文字なし / `<scheme>:` なし / `/auth` 配下でない / `/api` 配下でない を decode 前後の両方で検証。`decodeURIComponent` が `URIError` を throw した場合は即 false（`/%`, `/%E0%A4%A`, `/%G0`, `/%2F%`, `/dm/%C0%AF` overlong 等の malformed encoding を拒否）。
- `resolveAuthRedirectTarget(searchParams, defaultGame)`: `next` が safe ならその値、それ以外は `/{defaultGame}/battle` を返却。

#### 既存ファイル修正

- `src/app/share/[id]/page.tsx`: 「ログイン / 新規登録」リンクの href に `?game=<gameSlug>&next=/{gameSlug}/home` を付与。
- `src/app/auth/page.tsx`:
  - `useSearchParams()` で `game` / `next` を取得し、`isGameSlug` / `isSafeInternalPath` で検証。
  - 検証成功した `game` を localStorage / cookie に persist（既存 `selectedGame` キー）。
  - **`resolvedTarget` を 1 度算出し、`onAuthStateChange` SIGNED_IN / `signInWithPassword` 成功 / `signUp` 成功の 3 箇所すべてで `window.location.href = resolvedTarget`**（OAuth + email/password 両経路で着地点を共有）。
  - `signInWithOAuth` の `redirectTo` に検証済の `game` / `next` を `URLSearchParams` で組み立てて付与（OAuth provider 経由でも callback まで保持）。
- `src/app/auth/callback/page.tsx`:
  - 既存 `SIGNED_IN` 処理を変更せず、`new URLSearchParams(window.location.search)` で受信時に `game` / `next` を **再検証**（callback URL は外部からも叩けるため必須）。
  - `resolvedTarget` を 1 度算出し、SIGNED_IN ハンドラと fallback timeout の両方で同じ値を使用。
  - `selectedGame` を再 persist。

---

## 3. レビュー・反復履歴

Plan A は plan ファイル作成段階で plan-critic を 6 反復 + Codex を 3 周通し、実装後にさらに Codex 実機レビューを 2 周受けた。

### 3.1 plan-critic 6 反復（plan 作成チャット）

`/review-plan-loop docs/plans/2026-05-27_plan_a_public_launch_safety.md` を回し、plan-critic の機械的指摘は自動修正、判断要案件は AskUserQuestion で escalation して GO 判定まで詰めた。主な確定事項:

- **RD-1**: A-1 の prefix 取得方法を `app_settings` テーブルの新規行 INSERT 方式に確定（`current_setting` や migration 二重管理を棄却）。
- **RD-2**: display sanitizer の検証範囲を「prefix + user_id 一致」の defense-in-depth に拡張、SELECT 列に `user_id` を追加。
- **RD-3**: `error.tsx` / `not-found.tsx` で `useSelectedGame()` の `ready` 待ち + pathname 優先、共通 `<HomeLink />` 化。
- **RD-4**: `BanGuard` のリトライ + 最終 fail-open + `LoadingSpinner` 表示、ban 強制は Plan D に委譲。

### 3.2 Codex 3 周（plan 作成チャット）

| 周 | 指摘要旨 | 反映 |
|---|---|---|
| 第 1 回 | OAuth `redirectTo` 固定 / migration 順序矛盾 / RD 反映漏れ / open redirect helper 確定 / `npm test` `@rolldown/binding-darwin-arm64` 既知ブロッカー | §A-4 OAuth redirectTo + email/password 3 経路共有、§A-1 順序統一、§9.1 復旧手順追記、helper 仕様確定 |
| 第 2 回 | email/password 経路 resolvedTarget 共有 / `storage_public_url_prefix` 初回 INSERT 時の validation 効かない問題 / `current_setting` 案削除 / malformed percent encoding 拒否 + テスト | §A-4 3 箇所共有を明示、`validate_app_settings` 更新直後に no-op UPDATE で強制再評価する案 (a) 採用、`current_setting` 削除、helper 仕様にエンコード不正 5 件追加 |
| 第 3 回（最終） | `ReadOnlySearchParamsLike` 型導入 / Supabase Auth Redirect URLs 設定確認の手順 / §10 未解決質問の整理 / plan 全体整合確認 | helper のシグネチャを `ReadOnlySearchParamsLike` に、§10.B「該当なし」へ集約、ヘッダに「本 plan ファイルの取り扱い」明示 |

### 3.3 実装後の Codex 追加修正（実装チャット）

| # | 指摘 | 反映 commit |
|---|---|---|
| 1 | `src/lib/auth/redirect.ts` の `CONTROL_CHARS` に literal `0x00` / `0x1F` / `0x7F` が混入し Git が binary として扱う（`file` が data 扱い、`git show --numstat` が `- -`、`rg` / `grep` が binary file として扱う） | `65c2ac7`: 正規表現を `/[\x00-\x1F\x7F]/` の ASCII escape に置換 |
| 2 | `shares_validate_image_url` trigger が `BEFORE INSERT OR UPDATE ON public.shares` で全 UPDATE で発火する設計のため、既存外部 URL 行が残っていた場合に `expires_at` 再計算 UPDATE 等も失敗する | `65c2ac7`: `BEFORE INSERT OR UPDATE OF image_url, user_id ON public.shares` に絞る（対応方針 B 採用、判断理由は commit message 参照） |

### 3.4 dev preview 実機 regression（dev preview 検証チャット）

dev preview で staging share の og:image / twitter:image / `<img src>` が staging Supabase Storage の public URL ではなく `/api/og/[id]` の next/og 動的生成画像に倒れる現象を Codex が curl で検出。原因は display sanitizer の `allowedPrefix` を `process.env.NEXT_PUBLIC_SUPABASE_URL` から組み立てる際に Cloudflare staging build / runtime の env 値の trailing slash 等のズレで一致が外れていたこと。

`ef9daaf` で以下を反映:

- `sanitizeShareImageUrl` の opts を `allowedPrefix` 単数と `allowedPrefixes` 複数の両対応に拡張、null / undefined / 空文字エントリは無視。
- `normalizeSupabaseStoragePrefix(supabaseUrl)` を追加し trailing slash を 1〜複数まとめて剥がす。
- `share/[id]/page.tsx` / `api/og/[id]/route.tsx` で `loadStoragePublicUrlPrefix(supabase)` を呼び `app_settings.storage_public_url_prefix` を **一次正**、`normalizeSupabaseStoragePrefix(process.env.NEXT_PUBLIC_SUPABASE_URL)` を **二次 fallback** として `allowedPrefixes` で sanitize する設計に変更。
- trailing slash 付き `NEXT_PUBLIC_SUPABASE_URL` で safe URL が弾かれない統合テストを 2 件追加。

任意外部 URL を許可する方向には一切戻していない。

---

## 4. DB migration 適用

### 4.1 staging DB（2026-05-27）

memory `supabase-migration-ops.md` の既知事象どおり `npx supabase db push --db-url ...` は `@supabase/cli-darwin-x64` バイナリが `SIGILL` で即死。回避として `npm install pg --no-save --no-package-lock` で pg ドライバを `node_modules` に導入し、node inline script で適用。

順序:
1. preflight: `total_shares=12 / with_image_url=12 / suspicious_external_url=0`
2. `app_settings.storage_public_url_prefix` 行を staging Storage URL（`https://uqndrkaxmbfjuiociuns.supabase.co/storage/v1/object/public/share-images/`）で INSERT
3. pg client で `BEGIN` → migration body 全体を simpleQuery で送信 → `INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ($1, $2, $3)`（`statements` は migration body 全文を 1 要素 `text[]` で記録）→ `COMMIT`
4. `schema_migrations` tail に `20260527000001 shares_image_url_storage_only` を確認
5. DO block smoke test（拒否=成功 / 通った=失敗 RAISE）で `NOTICE: smoke passed: malicious image_url was rejected: shares.image_url must point to share-images/<user_id>/ ...` を確認

実行ログでは `postgresql://...` を `postgresql://[REDACTED]` に sed フィルタした上で出力。

### 4.2 dev preview 実機検証 → 本番反映

staging migration 適用後、dev preview で:
- OAuth フロー（X / Google）→ `/auth?game=pokepoke&next=/pokepoke/battle` → `/pokepoke/battle` 着地
- 共有 URL の game / next 引き継ぎ
- open redirect 拒否
- A-1 regression（前述）検出と修正

すべて OK 後、`git checkout main && git pull && git merge dev && git push origin main` を実施。Cloudflare 本番デプロイ完了後、main の HEAD は `b151d17 Merge branch 'dev'`。

### 4.3 production DB（2026-05-27、本番コード反映後）

production の `NEXT_PUBLIC_SUPABASE_URL` は staging とは別の project ref。実行前に **多段ガード** で staging との取り違えを防止:

1. `PROD_SUPABASE_URL` から正規表現で project ref を抽出し、staging ref (`uqndrkaxmbfjuiociuns`) と一致しないことを確認
2. pg client の `current_user` から（pooler URL なら）project ref を抽出し、`PROD_SUPABASE_URL` の ref と整合確認
3. 接続先 `current_database()` と user の確認ログを出力（secret 部分は伏字）

その後、staging と同じ順序で適用:
- preflight: `total_shares=58 / with_image_url=38 / suspicious_external_url=0`
- `app_settings.storage_public_url_prefix` 行を production Storage URL prefix で INSERT
- migration 適用 + `schema_migrations` に記録
- `schema_migrations` tail に `20260527000001 shares_image_url_storage_only` を確認
- DO block smoke test → `NOTICE: smoke passed: ...` 確認

production の既存 safe share 1 件で `/api/og/<id>` の HTTP 挙動も検証:
- `curl -sI https://tierlog.app/api/og/<id>` → `HTTP/2 302`、`location` ヘッダが production Storage public URL（`https://<prod-ref>.supabase.co/storage/v1/object/public/share-images/<user_id>/<file>.png`）
- 同 share の `og:image` / `twitter:image` meta も同一 Storage URL

display sanitizer の DB prefix 一次正経路（A-1 regression fix で導入）が production で正しく動作することを確認。

---

## 5. 検証

### 5.1 Claude 側で完結した検証

| 検証 | 結果 |
|---|---|
| `npm run lint`（実装 4 ファイル単体） | clean ✅ |
| `npm run lint`（プロジェクト全体） | 25 errors（後述、Plan A 範囲外の既存事象） |
| `npx tsc --noEmit` | pass（no output） |
| `npm test -- --run` | 7 files / **144 tests passed**（前回 132 + 新規 12 件、`image-url` 24/24、`redirect` 19/19） |
| `git grep "/home"` 残置確認 | `BottomNav.tsx` suffix + `middleware.ts` `LEGACY_ROOTS` のみ（意図通り） |
| `git grep router.push slug なし legacy` | 残置なし |
| U+FFFD grep | 残置なし |
| hardcoded URL grep（`tierlog.app` / `workers.dev` / `supabase.co`） | `mailto:contact@tierlog.app` のみ（URL ではない、許容） |
| `getSession()` 一括置換チェック（src/lib/actions/ 内） | 既存 Bearer JWT 用途のみ維持、Plan A での新規追加なし |
| staging DB migration list | applied ✅ |
| staging DB smoke test（DO block） | `smoke passed` ✅ |
| production DB migration list | applied ✅ |
| production DB smoke test（DO block） | `smoke passed` ✅ |
| 本番 `curl -sI /` / `/auth` / `/terms` / `/privacy` | `HTTP/2 200` ✅ |
| 本番 `curl -sI /nonexistent-route` | `HTTP/2 404` ✅（not-found.tsx 経路） |
| 本番 `curl -sI /api/og/<nonexistent>` | `HTTP/2 404` ✅（share row 不在で 404、sanitize 経路 正常） |
| 本番 `curl -sI /api/og/<existing safe share>` | `HTTP/2 302` + production Storage URL ✅ |
| 本番 `/share/<safe share>` の `og:image` / `twitter:image` | production Storage URL ✅ |
| Cloudflare Web Analytics beacon | SSR HTML に `cloudflareinsights.com/beacon.min.js` 含む ✅ |

### 5.2 ユーザー実機確認（dev preview + 本番）

- dev preview:
  - OAuth（X / Google）からの `/auth?game=...&next=...` 流入 → `next` 着地 OK
  - 共有導線の game 引き継ぎ OK
  - open redirect 拒否 OK（`/auth?next=https://malicious.example` で default `/{game}/battle` に倒れる）
  - BanGuard fail-open OK（DevTools で Supabase auth endpoint を block → 白画面でなく通常 UI に通過）
  - X 投稿のカードプレビューに画像表示 OK
  - X 投稿リンクから開いた share ページの画像が ShareModal「画像を保存」と同一フォーマット OK
- 本番（`https://tierlog.app`）:
  - 通常ログイン OK
  - `/auth?game=pokepoke&next=/pokepoke/battle` → `/pokepoke/battle` 着地 OK
  - 新規 share 作成 OK
  - X 投稿のカードプレビュー画像表示 OK
  - X 投稿リンク先の share ページ画像が ShareModal 保存画像と同一フォーマット OK

---

## 6. 本番反映フロー（plan §A-1「Code 先 → Migration 後」順守）

1. ✅ dev branch で実装 + dev push → Cloudflare dev preview デプロイ
2. ✅ staging DB に `app_settings.storage_public_url_prefix` 行 INSERT + migration 適用 + smoke test
3. ✅ Supabase staging Auth Redirect URLs に `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/auth/callback**` を追加（query 付き callback 許可）
4. ✅ dev preview で OAuth / share / open redirect / BanGuard / X カード 全実機確認
5. ✅ ユーザー「本番反映」明示指示
6. ✅ `git checkout main && git pull && git merge dev && git push origin main` → Cloudflare 本番デプロイ
7. ✅ 本番 smoke check（`curl` で HTTP status / SSR HTML / Cloudflare beacon / CSP / `/api/og` 経路）
8. ✅ Supabase production Auth Redirect URLs に `https://tierlog.app/auth/callback**` を追加（query 付き callback 許可、最小範囲のみ）
9. ✅ ユーザー「production migration 適用」明示指示
10. ✅ production DB に多段ガード後 `app_settings.storage_public_url_prefix` 行 INSERT + migration 適用 + smoke test
11. ✅ 本番実機（OAuth + share + X カード + 画像一致）
12. ✅ `git checkout dev` で作業ブランチに戻る

---

## 7. 既知事項 / Plan A 範囲外

### 7.1 `eslint-plugin-react-hooks@7.1.1` の新ルール抵触（既存事象）

`react-hooks/set-state-in-effect` ルールが既存コードの 25 箇所で検出（`BattleRecordForm.tsx`, `EditBattleModal.tsx`, `dm/stats/page.tsx`, `pokepoke/stats/page.tsx`, `admin/*`, `account/*` 等）。Plan A 当初 commit (`f7d0f17`) では `eslint-plugin-react-hooks` の version が違ったため lint pass していたが、その後の `npm install` 副作用（regression fix 検証時の `npm install pg --no-save` のついでに peerDeps が再解決された影響）で version が `7.1.1` に上がり、新ルールが有効化された。Plan A の touch 4 ファイル単体は lint clean。修正は別 issue で扱う想定。

### 7.2 `/auth` SSR が Suspense fallback で表示される（機能影響なし）

Plan A A-4 で `auth/page.tsx` に `useSearchParams()` を導入したため、Next.js 16 の挙動として **直近の Suspense 境界（新規追加した `app/loading.tsx`）が SSR fallback で render** される。X (Twitter) / Google ログインボタンや email/password フォームは CSR hydrate 後に表示される。

dev preview / 本番ともに OAuth / email/password フローは正常動作確認済のため機能 regression なし、`<title>` / `<meta og:*>` も SSR で全て出力されており SEO 影響なし。改善したい場合は `auth/page.tsx` を局所 `<Suspense>` でラップする小修正で対応可能（Plan A 範囲外）。

### 7.3 Plan A スコープ外の残課題

統合 audit の以下は別 plan で実施予定:

- **Plan B**: Observability / OG フォント / SEO（Sentry scrubber, OG フォント Cloudflare 対応、sitemap、noindex）
- **Plan C**: Multi-Game DB Scope（`get_team_member_summaries` / detection / quality scoring の game scope 拡張）
- **Plan D**: Access Gate / Auth Expiry（ban / suspended / unpaid の DB レイヤ強制、`getUser()` 用途整理、middleware session refresh、`if (!user) return []` 統一）— Plan A の BanGuard 修正は表層対応で Plan D が再設計する想定
- **Plan E（Phase 2）**: 初回オンボーディング / `recharts` lazy / Discord refresh / test 復旧
- **Phase 3**: 収益化（Stripe / 広告 / 法務）

---

## 8. 関連リンク

- plan: `docs/plans/2026-05-27_plan_a_public_launch_safety.md`
- 元レポート: `docs/reports/2026-05-27_integrated_pre_public_monetization_audit.md` §7 Plan A
- 個別 audit: `docs/reports/2026-05-26_claude_code_pre_public_monetization_audit.md`, `docs/reports/2026-05-27_codex_pre_public_monetization_audit.md`
- 前回完成度レビュー: `docs/reports/2026-05-20_pre_public_readiness_review.md` (62/100 → 83/100 → Plan A 反映完了)
- 関連 commit:
  - `f7d0f17 feat(safety): Plan A 一般公開前安全対応一式 (A-1〜A-4)`
  - `65c2ac7 fix(plan-a): Codex 第 3 回指摘の 2 件反映`
  - `ef9daaf fix(plan-a): share 画像 sanitizer の env prefix ズレを解消 (#A-1 regression)`
  - `b151d17 Merge branch 'dev'`（main 反映）
- migration: `supabase/migrations/20260527000001_shares_image_url_storage_only.sql`
- rollback: `supabase/rollback/20260527000001_rollback.sql`
- 運用 memory: `supabase-migration-ops` (pg 直叩き手順 + schema_migrations 手動記録)、`feedback-trigger-smoke-test` (DO block 拒否系 smoke test)

---

## 9. まとめ

Plan A は一般公開前の P0 / P1 ブロッカー 4 件を解消する UI / route / DB hardening として、plan 作成 → plan-critic 6 反復 → Codex 3 周 → dev 実装 → Codex 実機 2 件追加修正 → dev preview 検証 + 1 件 regression 修正 → staging DB → main 反映 → 本番 smoke → production DB → 本番実機検証、まで完走した。

任意外部 URL を許可する方向へ後退せず、`shares.image_url` の二段防御を本番まで維持。共有導線 / 未ログイン導線の game / next 引き継ぎは OAuth と email/password の両経路で同一の `resolvedTarget` を共有し、open redirect は decode 前後の厳格な検証で防御。404 / loading / error の SSR fallback も整備し、文字化けも解消。本番実機で X 投稿のカードプレビューと share ページ画像が ShareModal 保存画像と同一フォーマットになることまで確認できた。

残スコープ（Plan B / C / D / E）は別 plan で扱う。
