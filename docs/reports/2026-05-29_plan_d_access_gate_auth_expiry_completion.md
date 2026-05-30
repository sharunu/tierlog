# 実装報告書: Plan D Access Gate / Auth Expiry 本番反映完了

- 報告日: 2026-05-29
- 対象 plan: `docs/plans/2026-05-28_plan_d_access_gate_auth_expiry.md`
- 前提 plan (すべて完了済・非破壊維持):
  - `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md` (Plan A)
  - `docs/reports/2026-05-27_plan_b_observability_og_seo_completion.md` (Plan B)
  - `docs/reports/2026-05-28_plan_c_multi_game_db_scope_completion.md` (Plan C)
- ステータス: **dev 実装 + Codex 2 周反映 + staging 適用 + 本番ビルド失敗 → 原因特定・修正 → dev preview 実機確認 + main 反映 + production migration (D-1 先行 / D-2・D-3 後行) + production smoke test まで完了**
- 関連 commit (新しい順):
  - `1ad5657 Merge dev: AuthGuard useSearchParams Suspense build fix` (main 再反映、build green、本番 live、2026-05-29)
  - `041b565 fix(plan-d): AuthGuard の useSearchParams を Suspense 境界で包み本番ビルド失敗を解消`
  - `bff7307 Merge dev: Plan D Access Gate / Auth Expiry (D-1〜D-7) 本番反映` (初回 main 反映 / **Cloudflare build failed・未デプロイ**)
  - `62d4556 fix(plan-d): Codex review 2 P1/P2 反映`
  - `54d4111 fix(plan-d): Codex review P0/P1 反映`
  - `3300ff2 feat(plan-d): Access Gate / Auth Expiry (D-1〜D-7)`
- DB migration: **3 ファイル** (production 適用済・適用順序が異なる点に注意)
  - `20260528000001_d1_account_access_state.sql` — **additive expand、code deploy 前に production 先行適用**
  - `20260528000002_d2_write_rls_access_gate.sql` — code deploy (main build green) 後に適用
  - `20260528000003_d3_rpc_access_gate.sql` — D-2 と同一 transaction で適用
  - rollback 3 ファイル (`supabase/rollback/2026052800000[1-3]_rollback.sql`、ロールバック順序 D-3 → D-2 → D-1)
- runbook: `docs/runbooks/access_gate_operation.md`

---

## 1. サマリ

Plan D は「stage=4 (BAN) ユーザーが REST 直叩き / SECDEF 関数経由で書き込めてしまう経路」と「認証切れ時の UX (無言失敗)」を塞ぐ access gate + auth expiry ハンドリングを導入するもの。D-1〜D-7 を実装し、本番 (`https://tierlog.app` + Supabase production project ref `asjqtqxvwipqmtpcatvz`) まで反映を完了した。

- **D-1 `account_access_state(uid)`**: `'active' / 'banned' / 'unauthenticated' / 'unknown'` を返す STABLE + SECURITY DEFINER 関数。admin は `profiles.is_admin` 直 SELECT で例外的に常に `'active'` (RD-D1-A、`is_admin_user` overload は作らない)。将来 `'suspended'/'unpaid'/...` を Phase 3 Stripe 用に予約。
- **D-2 書き込み系 RLS access gate**: `battles` / `decks` / `deck_tunings` の INSERT+UPDATE、`shares` の INSERT に `AND public.account_access_state((SELECT auth.uid())) = 'active'` を末尾 append。既存 depth-defense (所有/format-game/EXISTS) は完全保持。SELECT / DELETE は変更せず (BAN ユーザーの閲覧・削除権は維持)。`feedback` / `team_members` は対象外 (不服申立て経路維持・直接書き込み薄)。
- **D-3 書き込み系 SECDEF 関数の gate**: subject 別グループ分け。group A (本人 auth.uid() gate: `update_my_display_name` / `sync_my_x_connection` / `clear_my_x_connection`)、group B (service_role + p_user_id gate: `sync_team_membership`)、group C-1 (cron 経路は **gate を入れない**: `run_daily_opponent_deck_batch`)、group C-2 (admin 経路は既存 admin check + gate: `recalculate_opponent_decks`)。`auto_add_opponent_deck` は **touch しない** (battles INSERT POLICY で既に防がれる + 最新定義温存、Codex P0)。
- **D-4 重要 API route の gate**: `requireBearer(request, { requireActiveUser })` (default true) を導入。`/api/account/delete` のみ opt-out (false、RD-D4-1)。Bearer を持たない `/api/discord/callback` は `stateRow.user_id` に対し inline で `account_access_state` を確認。
- **D-5 `AuthExpiredError` + `AuthGuard`**: 三重経路 (catch 内 `handleAuthExpiredError` → CustomEvent / `unhandledrejection` fallback / CustomEvent listener) で認証切れ時に `/auth?next=<current>` へ redirect。`isRedirecting` で de-dup、pathname 変化でリセット (Codex 2 P2)。
- **D-6 middleware session refresh**: Plan A の挙動を壊さないため**不要と判定**しコメントのみ (RD-D6-1)。
- **D-7 接続性明文化**: Plan A BanGuard fail-open / Plan C `profiles.stage = MAX(score)` との関係を文書化。

本番反映の過程で **初回 main build が Cloudflare で失敗** (§4) する事象が発生したが、原因を特定・修正し、`D-1 先行適用 → code deploy → D-2/D-3 適用` の順序 (§7) で安全に完了した。production smoke test (deploy 系 + DB 系) はすべてパス。Plan A / B / C 完了済領域は非破壊で維持。

---

## 2. 実装内容 (D-1〜D-7)

### 2.1 D-1: `account_access_state(p_uid uuid)` DB 関数

- 戻り値: `'unauthenticated'` (uid NULL) / `'unknown'` (profiles 行なし or stage NULL) / `'active'` (admin **または** stage 1-3) / `'banned'` (stage=4 かつ非 admin)
- `SELECT COALESCE(is_admin,false), stage INTO ... FROM public.profiles WHERE id = p_uid` の直 SELECT で admin 例外を担保 (RD-D1-A)。`is_admin_user(p_uid)` overload は作らない。
- STABLE + SECURITY DEFINER + `SET search_path = ''` の既存規約準拠
- `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role;`
- 将来予約値: `'suspended' / 'unpaid' / 'canceled' / 'past_due'` (Phase 3 Stripe)
- ファイル: `supabase/migrations/20260528000001_d1_account_access_state.sql` / `supabase/rollback/20260528000001_rollback.sql`

### 2.2 D-2: 書き込み系 RLS access gate

- DROP + CREATE で挙動互換に POLICY を書き換え (旧 POLICY 名完全一致で idempotent)。末尾に `AND public.account_access_state((SELECT auth.uid())) = 'active'` を AND
- 対象 7 POLICY: `battles` INSERT/UPDATE、`decks` INSERT/UPDATE、`deck_tunings` INSERT/UPDATE、`shares` INSERT
- `(SELECT auth.uid())` ラップで `20260511000003` の initplan 最適化規約を維持
- SELECT / DELETE は変更しない。`feedback` / `team_members` は対象外
- ファイル: `supabase/migrations/20260528000002_d2_write_rls_access_gate.sql` / `supabase/rollback/20260528000002_rollback.sql`

### 2.3 D-3: 書き込み系 SECDEF 関数の access gate

- group A (auth.uid() gate): `update_my_display_name(text)` / `sync_my_x_connection()` / `clear_my_x_connection()` に `IF public.account_access_state(v_uid) <> 'active' THEN RAISE EXCEPTION 'account_banned'; END IF;`
- group B (p_user_id gate): `sync_team_membership(uuid, text, jsonb, text)` — service_role 経路で `auth.uid()` が NULL になるため `p_user_id` を gate 対象。admin 例外は `account_access_state` 内で担保
- group C-1 (gate なし): `run_daily_opponent_deck_batch()` — cron 経由で `auth.uid()` NULL → gate を入れると `'unauthenticated'` で必ず停止するため**絶対に入れない**。本 migration では touch しない
- group C-2 (admin + gate): `recalculate_opponent_decks(text, text)` — 既存 `is_admin_user()` check の直後に gate 追加。admin は `account_access_state` の admin 例外で `'active'` が返り素通る
- `auto_add_opponent_deck`: **touch しない** (battles INSERT POLICY で防御済 + `20260513000003` REVOKE + `20260520000001` 最新挙動を温存、Codex review P0 反映)
- ファイル: `supabase/migrations/20260528000003_d3_rpc_access_gate.sql` / `supabase/rollback/20260528000003_rollback.sql`

### 2.4 D-4: 重要 API route の gate

- `src/lib/auth/require-bearer.ts`: `requireBearer(request, options)` に `requireActiveUser?: boolean` (default true) を追加。有効 Bearer → user 解決後に `account_access_state` RPC を呼び、`'active'` 以外は 403 `account_not_active`
- **missing-function fallback** (Codex 2 P1): `isMissingFunctionError()` (PGRST202 / "Could not find the function" / schema cache / "function...does not exist") で D-1 未適用時は一時的に active 通過 (console.warn)。それ以外の RPC エラーは 403。← **deploy 順序事故 (D-1 未適用で API 全断) の保険**
- `/api/account/delete`: `requireBearer(request, { requireActiveUser: false })` で opt-out (RD-D4-1、BAN ユーザーも退会可)
- `/api/discord/callback`: Bearer を持たない (OAuth state 経由) ため `stateRow.user_id` に対し inline で `account_access_state` を確認 (missing-function fallback 込み)
- `/api/discord/start` / `/api/discord/refresh-guilds` / `/api/admin/limitless-sync`: 手動 Bearer 検証を `requireBearer` に集約

### 2.5 D-5: `AuthExpiredError` + `AuthGuard`

- `src/lib/errors/auth-expired-error.ts` (新規): `AUTH_EXPIRED_EVENT_NAME = "tierlog:auth-expired"` / `AuthExpiredError extends Error` / `handleAuthExpiredError(error): boolean` (SSR noop、`instanceof AuthExpiredError` なら CustomEvent dispatch して true)
- `src/components/providers/AuthGuard.tsx` (新規): 三重経路で `/auth?next=<current>` redirect。`next` は `isSafeInternalPath` (Plan A の open redirect helper) で検証。`isRedirecting` ref で de-dup、pathname 変化でリセット (Codex 2 P2)、public path skip
- `src/lib/actions/deck-actions.ts` / `account-actions.ts` / `battle-actions.ts` / 各 page・component の catch: 重要操作・UI 表示で `AuthExpiredError` throw / `handleAuthExpiredError(e)` 呼び出し。`getUserStage` は BanGuard fail-open 依存のため `return 2` 維持
- レイアウト配置: `src/app/layout.tsx` で `<ErrorBoundary><AuthGuard><BanGuard>{children}</BanGuard></AuthGuard></ErrorBoundary>` (BanGuard と並列、責務分離)

### 2.6 D-6 / D-7

- D-6: `src/middleware.ts` に「session refresh は Plan A の挙動を壊さないため不要」とコメント明記 (RD-D6-1)。Plan A の auth 挙動は touch せず
- D-7: `docs/runbooks/access_gate_operation.md` に Plan A BanGuard fail-open (stage 取得失敗時 `return 2`) / Plan C `profiles.stage = MAX(score)` との接続性を文書化

---

## 3. 検証 (Claude 自前)

- `npm run lint` / `tsc` / `npm test` (GitHub Action `lint + typecheck + test`): green
- SECDEF 関数全件 grep (D-3 網羅性) / `if (!user)` 全件分類 (D-5) / require-bearer 拡張確認 (D-4) / Plan A BanGuard 非 touch を git diff で確認 (D-7)
- staging (project ref `uqndrkaxmbfjuiociuns`) に D-1→D-2→D-3 適用 + smoke test 全項目パス
- **`npx opennextjs-cloudflare build` (local) で本番相当ビルドを再現** — §4 の build 失敗の特定・修正検証に使用

---

## 4. 【重要教訓 1】初回 main build 失敗と復旧

### 4.1 事象

`bff7307` (Plan D 初回 main 反映) を push 後、**Cloudflare の Workers Builds が failure** となり、Plan D コードは本番にデプロイされなかった。本番 `tierlog.app` は直前の成功ビルド (`183086c`、Plan D 前) を serve し続けていた。`lint + typecheck + test` (GitHub Action) は **success** だったため CI 上は緑に見えていた。

### 4.2 根本原因: root layout 配置の `AuthGuard` + `useSearchParams`

D-5 で追加した `AuthGuard` が `useSearchParams()` を呼び、これを **root layout (`src/app/layout.tsx`) に配置**したため、全ページ (静的 prerender される `/auth/callback` 等を含む) のツリーに `useSearchParams` が入り、Next.js の static export 段階で:

```
⨯ useSearchParams() should be wrapped in a suspense boundary at page "/auth/callback".
  (missing-suspense-with-csr-bailout)
Error occurred prerendering page "/auth/callback".
```

が発生して build が落ちていた。**tsc / lint / test では検出されず、OpenNext / `next build` の static export 段階でのみ顕在化**するクラスのエラー。

### 4.3 修正 (`041b565`)

`useSearchParams` を使う本体ロジックを `AuthGuardWatcher` に切り出し `<Suspense fallback={null}>` で包囲。`{children}` は Suspense の外で通常どおり static 描画されるため SSR / SEO / 既存 redirect 挙動は不変。

```tsx
export function AuthGuard({ children }) {
  return (
    <>
      <Suspense fallback={null}><AuthGuardWatcher /></Suspense>
      {children}
    </>
  );
}
// AuthGuardWatcher: useRouter/usePathname/useSearchParams + 三重経路 effect、null を描画
```

- local clean build: **44/44 ページ生成 + `Worker saved in .open-next/worker.js` まで成功**
- dev build (`041b565`): Cloudflare Workers Builds **completed:success** (Plan D 初の成功ビルド)
- main 再反映 (`1ad5657`): Cloudflare Workers Builds **completed:success**、本番 live 確認

### 4.4 【重要教訓 2】preview URL の目視だけでは「新コード live」確認にならない

調査の結果、**Plan D の dev 3 コミット (`3300ff2` / `54d4111` / `62d4556`) すべて Workers build = failure** だった。Cloudflare の preview URL は build 失敗時に**直前の成功ビルドを serve し続ける**ため、`dev-...workers.dev` を開いて「動いている」だけでは新コードがデプロイされた保証にならない。実際、当初「dev preview で実機確認できた」と認識していた AuthGuard 等の挙動は、Plan D 前の旧ビルドを見ていたもので、Plan D は dev preview にも一度も実デプロイされていなかった。

`041b565` で build を green にして初めて Plan D が dev preview に実 live となり、そこで改めて実機確認 (通常ログイン / 主要ページ / Cookie・LocalStorage 削除 → `/auth?next=` redirect / 再ログイン復帰 / 二度目の削除でも再 redirect = Codex 2 P2 検証 / デッキ追加 / 戦績登録・編集 / 表示名更新 / Plan B regression) を実施して OK を確認した。

### 4.5 【重要教訓 3】今後の live 確認手順

preview / 本番 URL の目視に依存せず、以下で確認する:

1. **Cloudflare build status を権威ある情報源で確認**:
   ```
   gh api repos/sharunu/tierlog/commits/<sha>/check-runs \
     --jq '.check_runs[] | select(.name=="Workers Builds: duepure-tracker") | "\(.status):\(.conclusion)"'
   ```
   `completed:success` を確認。check-run の output は dashboard リンクのみでログ本文を持たないため、失敗時の原因は **local `npx opennextjs-cloudflare build` で再現**して取得する。
2. **bundle marker grep**: デプロイ済みコードに含まれる一意文字列を bundle 内で確認 (Plan D は `tierlog:auth-expired`)。turbopack runtime chunk の hash は turbopack バージョンが同じだと変わらず fingerprint には不向き。
3. 主要ページ HTTP / API ステータスの smoke check と併用。

(本知見は memory `cloudflare-build-verification` にも記録済)

---

## 5. main 反映と本番デプロイ

| 項目 | 内容 |
|---|---|
| main HEAD before | `183086c Merge branch 'dev'` (Plan C 反映後) |
| 初回反映 (失敗) | `bff7307` — Cloudflare build **failure**、本番未デプロイ (本番は `183086c` を継続 serve) |
| build 修正 | `041b565` (dev、AuthGuard Suspense 化) → dev build green |
| main HEAD after | **`1ad5657 Merge dev: AuthGuard useSearchParams Suspense build fix`** — Cloudflare build **green**、本番 live (2026-05-29) |
| 本番 live 確認 | root 200 + bundle に marker `tierlog:auth-expired` 検出 (`/_next/static/chunks/09.cqt8a180hi.js`) |

---

## 6. production migration 適用結果

適用方法: pg ドライバ直叩き (`npx supabase` SIGILL 回避、memory `supabase-migration-ops` 準拠)。各回 **production ref guard** (`asjqtqxvwipqmtpcatvz` present / `uqndrkaxmbfjuiociuns` absent) を確認。secret / DB URL / user id 全量はチャット非出力、一時スクリプトは適用後削除。

### 6.1 D-1 先行適用 (code deploy 前)

- `20260528000001_d1_account_access_state.sql` を **additive expand** として code deploy 前に production へ先行適用
- 非破壊 smoke test: `account_access_state(NULL)='unauthenticated'` / 0-uuid=`'unknown'` / stage=2='active' / admin (stage=1)='active' / stage=4 ユーザー 0 件 / 既存 SECDEF 群は未変更
- 旧本番コードはこの関数を参照しないため無害 (CLAUDE.md の additive expand 例外条件に合致)

### 6.2 D-2 + D-3 適用 (code deploy = main build green 後)

- `20260528000002_d2_*` + `20260528000003_d3_*` の **2 ファイルのみ**を**単一 transaction で atomic 適用 + COMMIT** (D-1 は再適用しない)
- `supabase_migrations.schema_migrations` に両 version 記録を確認
- 適用前 pre-check: D-2/D-3 未記録 / battles INSERT policy 未 gate / profiles stage=1×1(admin), stage=2×6, stage=4 0 件

```
20260528000001 d1_account_access_state     APPLIED (code deploy 前・先行)
20260528000002 d2_write_rls_access_gate    APPLIED (code deploy 後・D-3 と同一 txn)
20260528000003 d3_rpc_access_gate          APPLIED (code deploy 後・D-2 と同一 txn)
```

### 6.3 post-apply 構造検証 (15/15 PASS)

- schema_migrations に D-2 & D-3
- RLS 7 本 (battles/decks/deck_tunings INSERT+UPDATE、shares INSERT) に `account_access_state`
- SECDEF group A (3) / B (1) / C-2 (1) に gate
- `run_daily_opponent_deck_batch` に gate **なし**
- `auto_add_opponent_deck` 未 touch (gate なし、proacl `{postgres=X/postgres}` owner-only = `20260513000003` REVOKE 維持)

---

## 7. 【重要教訓 4】デプロイ順序 (D-1 先行 → code deploy → D-2/D-3) の有効性

本反映では以下の順序を採った:

```
1. D-1 (additive expand) を production へ先行適用     ← code がまだ呼ばない無害な関数追加
2. code deploy (main build green → 本番 live)         ← code が account_access_state を呼び始める
3. D-2 / D-3 (enforcement) を production へ適用         ← RLS / SECDEF gate を有効化
```

この順序が有効だった理由:

- **D-1 先行**: code (require-bearer / discord callback) が `account_access_state` を呼ぶ前に関数を用意することで、code deploy 直後の missing-function 事故を防止。万一順序が崩れても D-4 の `isMissingFunctionError` fallback (§2.4) が二重の保険として機能する設計
- **D-2/D-3 後行**: enforcement (write gate) を「対応する code (AuthGuard / AuthExpiredError UX) が live になった後」に有効化。gate だけ先行して UX が無い中間状態を避けた
- **逆順の危険**: DB を先に新スキーマ化して prod code が追従していないと本番が壊れる (CLAUDE.md の expand→code→contract 原則)。今回は enforcement (D-2/D-3) を contract 相当として code 反映後に回した
- 現行は全ユーザー stage<4 = `'active'` のため、各段階で write は透過 (regression なし)。stage=4 が今後発生した時点で初めて gate が作用する

---

## 8. production smoke test 結果

### 8.1 deploy 系 smoke (本番 URL、§5 の live 確認含む) — 全項目 PASS

| 項目 | 結果 |
|---|---|
| root HTTP / Plan D marker | 200 / `tierlog:auth-expired` 検出 (新ビルド実デプロイ確証) |
| 主要ページ (`/dm/home` `/dm/stats` `/dm/battle` `/dm/decks` `/account` + `/pokepoke/*` `/auth` `/auth/callback`) | 全て 200 (500 なし) |
| `account_access_state` 経路 API | discord/start→400 (invalid body)、refresh-guilds→401 (invalid_jwt)。**missing-function / 500 なし** |
| Plan B SEO | `/robots.txt` `/sitemap.xml` 200、本番 robots meta **不在** (正常)、OG meta + `/og-default.png` 200、`/api/og/<dummy>` 404 (graceful)、`/share/<dummy>` 200 (not-found UI) |

### 8.2 DB 系 smoke (D-2/D-3、非破壊・全 txn ROLLBACK) — 全項目 PASS

| # | 項目 | 結果 |
|---|---|---|
| 1 | RLS policy に account_access_state | 7 本すべて入っている |
| 2 | stage=4 擬似ユーザー battles INSERT | **拒否 42501** (SELECT 可視=1 でも INSERT のみ拒否) |
| 3 | stage=2 通常ユーザー書き込み | **成功** (rows=1) |
| 4 | SECDEF group A (`update_my_display_name`) | stage=2 成功 / stage=4 **account_banned** |
| 4 | SECDEF group B (`sync_team_membership`, p_user_id) | stage=4 **account_banned** |
| 4 | SECDEF group C-2 (`recalculate_opponent_decks`) | 非 admin **admin only** (既存 gate 維持) |
| 5 | `run_daily_opponent_deck_batch` | gate なし + service_role 実行可 (cron 停止リスクなし) |
| 6 | `auto_add_opponent_deck` | 未 touch (gate なし、owner-only proacl) |

- 擬似 stage=4 / `__smoke__` 表示名 / 複製 battles はすべて ROLLBACK 済。適用後の profiles 分布 (stage=1×1 / stage=2×6 / stage=4 0 件) で永続変更なしを確認
- `run_daily` は本番でフルバッチ実行はせず、構造 (gate なし) + grant (service_role 実行可) で検証

---

## 9. Plan A / Plan B / Plan C 非破壊確認

| 領域 | Plan D での影響 |
|---|---|
| A-1 `shares.image_url` 二段防御 (trigger + sanitizer) | ✅ 影響なし。`shares` INSERT POLICY は access gate を **末尾 append** のみ、`is_safe_share_image_url` trigger は touch なし |
| A-2 legacy URL / HomeLink / loading / global-error | ✅ 影響なし |
| A-3 BanGuard retry + fail-open | ✅ 影響なし。`BanGuard.tsx` touch なし。AuthGuard は **並列配置**で責務分離 (BanGuard=BAN UI / AuthGuard=auth redirect)。`getUserStage` の `return 2` fail-open 維持 |
| A-4 共有 / 未ログイン導線 `game/next` + open redirect 防御 | ✅ 影響なし。AuthGuard の `next` は Plan A の `isSafeInternalPath` を**再利用** |
| B-1〜B-6 Sentry / OG / noindex / sitemap / 公開ランディング / runbook / 法務 | ✅ 影響なし。`8.1` smoke で OG / SEO / share regression なしを実測 |
| C-1〜C-5 multi-game DB scope (team summary / detection / quality scoring) | ✅ 影響なし。D-3 は `sync_team_membership` に gate を**追加**するのみで game scope ロジックは保持。`run_daily` / detection / quality 関数の本体ロジックは未変更 |
| C `profiles.stage = MAX(score)` | ✅ D-1 の `account_access_state` は `profiles.stage` を**読むだけ**。stage 算出 (Plan C) は変更せず、D-7 で接続性を明文化 |

Plan D 変更は DB の access gate (RLS / SECDEF) + auth 系 client component + API route の Bearer 集約に限定され、A/B/C の機能後退はない。

---

## 10. 【重要教訓 5 / 保留事項】C-6 既存 detection_alerts 24 件の扱い

Plan C §5 / §7.5 で保留とした **production `detection_alerts` 24 件 (全て `game_title='dm'` 固定)** の扱いは、**Plan D では対象外で引き続き保留**。

- これらは Plan C 適用前の default 'dm' で記録されたデータで、真に dm 由来か pokepoke 誤分類かは未判定
- Plan C 後の新規 alert は正しく game 別に INSERT される (C-3 deployed)
- クリーンアップする場合は `docs/runbooks/plan_c_data_truncate.md` の手順 (preflight count → 明示承認 → pg_cron 一時停止 → TRUNCATE → 即時 re-scan → cron 再開)
- 誤分類を許容して新規 alert のみ正しく分類する運用も選択肢。**判断は別途** (Plan D の scope には含めない)

---

## 11. 反復履歴

- 実装初版 `3300ff2` (D-1〜D-7)
- Codex review 第 1 回 (P0/P1、`54d4111`):
  1. **P0**: D-3 が `auto_add_opponent_deck` を旧定義 (`20260426005408`) で CREATE OR REPLACE し、最新挙動 (`20260520000001`) 破壊 + REVOKE 済 authenticated EXECUTE 復活 → **D-3 から当該 CREATE OR REPLACE を完全除去** (touch しない方針、rollback も修正)
  2. **P1**: battle catch ブロックの `handleAuthExpiredError` 不足 → BattleRecordForm / EditBattleModal / dm・pokepoke の battle・decks page に追加 (grep 横断確認)
- Codex review 第 2 回 (P1/P2、`62d4556`):
  1. **P1**: require-bearer の `account_access_state` 無条件呼び出し (D-1 未適用で API 全断リスク) → `isMissingFunctionError` fallback + deploy 順序の runbook 化
  2. **P2**: AuthGuard `isRedirecting` が reset されず再ログイン後の redirect を取りこぼす → effect 冒頭で `false` リセット
  3. **P2**: deck tuning / reorder に `AuthExpiredError` 欠落 → `reorderDecks` / `createTuning` / `updateTuning` / `deleteTuning` に追加
- Codex 再レビュー: **ブロッカーなし**
- staging 適用 + smoke test 全項目パス
- **本番ビルド失敗 → 原因特定・修正 (`041b565`、§4)** ← 本反映特有のイベント
- dev preview 実機確認 (build green 後に初めて Plan D が live) OK → main 再反映 (`1ad5657`) → production migration (D-1 先行 / D-2・D-3 後行) → production smoke test 完了

---

## 12. 教訓まとめ (再掲)

1. **lint / typecheck / test が green でも Cloudflare (OpenNext) build は失敗しうる**。root layout 配置の component が `useSearchParams` を呼ぶと static export で `missing-suspense-with-csr-bailout` になる。対処は `<Suspense>` 境界化 (§4.2 / §4.3)。
2. **失敗ビルド中は preview / 本番 URL が旧ビルドを serve する**ため、URL の目視だけでは新コード live の確認にならない (§4.4)。
3. **live 確認は build check-run conclusion + bundle marker grep で行う** (§4.5、memory `cloudflare-build-verification`)。
4. **D-1 先行適用 → code deploy → D-2/D-3 適用の順序が有効** (§7)。enforcement を code 反映後に回し、missing-function fallback を保険に持つ。
5. **Plan A / B / C は非破壊で維持** (§9)。
6. **C-6 既存 detection_alerts 24 件の扱いは引き続き保留** (§10)。

---

## 13. 残スコープ (Phase 2 / Phase 3 / 別 plan)

- **Phase 3 (Billing)**: `account_access_state` の予約値 `'suspended' / 'unpaid' / 'canceled' / 'past_due'` を Stripe 課金状態と接続。BAN 以外の課金ベース access 制御を追加
- **D-3 group の Phase 2 整理**: detection 旧 overload DROP (Plan C §7.1) と同様に、access gate 周りで将来 contract が必要になれば別 migration
- **C-6 既存 detection_alerts 24 件** (§10): TRUNCATE するか誤分類許容かの判断
- **middleware session refresh** (D-6): 現状不要判定。将来 auth 体験改善で再評価する場合は Plan A の挙動を壊さない前提で別途

Plan D の本番反映により、stage=4 (BAN) ユーザーの書き込み経路 (REST 直叩き RLS / SECDEF 関数 / 重要 API route) はすべて塞がれ、認証切れ時は `/auth?next=` への自動 redirect で UX が改善された。admin は `account_access_state` の admin 例外で全経路を素通りし、cron (`run_daily_opponent_deck_batch`) は gate なしで継続稼働する。
