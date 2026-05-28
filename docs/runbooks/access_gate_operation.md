# Access Gate 運用 runbook

Plan D / D-7 で導入した DB レベル access gate と既存 Plan A / Plan C 機能の接続性を運用視点で整理する。

- 作成日: 2026-05-28
- 関連 plan: `docs/plans/2026-05-28_plan_d_access_gate_auth_expiry.md` D-7 / RD-D7-1
- 関連 plan A 完了報告: `docs/reports/2026-05-27_plan_a_public_launch_safety_completion.md`
- 関連 plan C 完了報告: `docs/reports/2026-05-28_plan_c_multi_game_db_scope_completion.md`

---

## 1. 概念図

```
[client UI]
    │
    ├─ BanGuard (Plan A): retry + fail-open / RD-B8 path 判定
    │     └─ stage=4 → BAN 画面
    │     └─ Supabase 一時障害 → fail-open (通常 UI 表示) ★1
    │
    ├─ AuthGuard (Plan D / D-5): AuthExpiredError → /auth?next=... redirect
    │     └─ 三重経路: handleAuthExpiredError / unhandledrejection / CustomEvent
    │
    └─ API call / RPC / 直接 supabase-js insert
            │
            ▼
[server / DB]
    │
    ├─ /api/admin/* / /api/discord/* / /api/account/delete:
    │     requireBearer({ requireAdmin?, requireActiveUser? })
    │       → account_access_state(user.id) = 'active' チェック
    │       → /api/account/delete のみ requireActiveUser: false で opt-out (RD-D4-1)
    │
    ├─ /api/discord/callback (Bearer なし):
    │     inline で stateRow.user_id を account_access_state チェック
    │
    └─ RLS / SECDEF 関数:
          - battles / decks / deck_tunings / shares INSERT/UPDATE
              → WITH CHECK ... AND account_access_state((SELECT auth.uid())) = 'active'
          - update_my_display_name / sync_my_x_connection / clear_my_x_connection
              → 本体先頭で account_access_state(auth.uid()) チェック
          - sync_team_membership (service_role 経路)
              → 本体先頭で account_access_state(p_user_id) チェック
          - recalculate_opponent_decks
              → 既存 admin check の直後に account_access_state(auth.uid()) チェック
          - run_daily_opponent_deck_batch (cron / service_role 専用)
              → gate を入れない (auth.uid() は NULL になり 'unauthenticated' で誤判定するため)
          - auto_add_opponent_deck (battles trigger 経由 + 直呼びも考慮)
              → 冗長 gate (admin 例外で素通り、stage=4 一般で弾く)

   ★1 BanGuard が fail-open しても、書き込み経路は DB 側 (RLS / RPC) で拒否される
       ため、不正利用にはならない (Plan D 接続性)
```

---

## 2. account_access_state(p_uid uuid) の戻り値

| 戻り値 | 意味 | 現状の発火条件 | 将来 (Phase 3 Stripe) |
|---|---|---|---|
| `'active'` | アカウント利用可 | stage ∈ {1, 2, 3} または `profiles.is_admin = true` (RD-D3-1) | デフォルト active |
| `'banned'` | 利用規約違反 BAN | `profiles.stage = 4` かつ非 admin | 同上 |
| `'unauthenticated'` | 未認証 | `p_uid IS NULL` | 同上 |
| `'unknown'` | profile 行未作成 | `auth.users` にはあるが `profiles` 行なし | 同上 |
| `'suspended'` (reserved) | — | (未使用、Plan D では発火しない) | 管理者による一時停止 |
| `'unpaid'` (reserved) | — | (未使用) | 課金未払い |
| `'canceled'` (reserved) | — | (未使用) | プラン解約済み |
| `'past_due'` (reserved) | — | (未使用) | 支払い期限超過 |

RD-D1 で text 型を採用したため、Phase 3 で Stripe webhook → `profiles.billing_state` 等を追加して `account_access_state` 内部のみ拡張すれば RLS / RPC / API route 側を一切変更不要。

---

## 3. Plan A BanGuard fail-open との接続

### 3.1 fail-open の動作

`src/components/providers/BanGuard.tsx` (Plan A) は:

- `supabase.auth.getUser()` + `getUserStage()` のリトライ (2 回まで, 300ms / 800ms backoff)
- 全 retry 失敗 → 最終 `setIsBanned(false)` (fail-open) で通常 UI 表示
- 理由: Supabase 一時障害時に全ユーザー画面停止を避ける UX 設計

### 3.2 Plan D による補完

BanGuard が fail-open しても、stage=4 ユーザーが書き込みを試みると:

| 経路 | 拒否されるレイヤ |
|---|---|
| `battles.insert` REST 直叩き | D-2 RLS (`WITH CHECK ... AND account_access_state = 'active'`) |
| `decks.insert` REST 直叩き | 同上 |
| `deck_tunings.insert / update` REST 直叩き | 同上 |
| `shares.insert` REST 直叩き | 同上 |
| `update_my_display_name` RPC | D-3 グループ A (本体先頭 gate) |
| `sync_my_x_connection` / `clear_my_x_connection` RPC | 同上 |
| Discord 連携系 API (`/api/discord/start` / `refresh-guilds`) | D-4 requireBearer + requireActiveUser |
| Discord OAuth callback (`/api/discord/callback`) | D-4 inline account_access_state チェック |
| admin 操作 (`/api/admin/*`) | D-4 requireAdmin + requireActiveUser (admin 例外で素通り) |

→ UI 側 fail-open は **不正利用に繋がらない**。「BAN 画面が出ない」だけで実害なし。

### 3.3 admin 復旧経路

admin (profiles.is_admin = true) が誤 stage=4 になった場合:
- `account_access_state` 関数内の RD-D3-1 例外で `'active'` が返るため、admin 操作は止まらない
- 管理画面 (`/admin/users/[userId]`) から自分自身の stage を 1〜3 に戻せる
- 他に admin がいる環境では他 admin からの復旧も可能

---

## 4. Plan C `profiles.stage = MAX(score)` 自動降格との接続

### 4.1 Plan C 完了の挙動

`_run_quality_scoring_internal` (Plan C C-4) は日次バッチ実行時に:

1. 各 game の `quality_score_snapshots` を再計算
2. **account-level `profiles.stage = MAX(score)`** で自動更新 (per-game stage は Phase 2 で別途検討)

### 4.2 stage=4 に降格した瞬間の効果

- `account_access_state(uid)` が即 `'banned'` を返すようになる
- 次の書き込み (battles INSERT 等) から DB レイヤで拒否される
- UI 側は BanGuard の次回 polling で BAN 画面に切り替わる
- 既に開いている画面 (BanGuard が `setIsBanned(false)` 確定済み) でも、ユーザーが操作した瞬間に DB が拒否するため不正利用にならない

### 4.3 復帰した瞬間の効果

quality scoring で stage=3 以下に MAX(score) が戻った場合:
- `account_access_state(uid)` が即 `'active'` を返すようになる
- 書き込み再開可能
- UI 側は次回 polling で BAN 画面が解除される

### 4.4 admin 手動変更時の効果

`admin_update_user_stage(p_user_id, p_new_stage, p_reason)` (`20260424000001:67`) で:
- stage 変更が `user_stage_history` に記録される (audit 追跡可)
- 即時 `account_access_state` の戻り値が変わる (transaction 整合)
- admin が `is_admin=true` の自分自身を誤って stage=4 にしても、admin 例外で操作継続可能

---

## 5. 既存 stage=4 ユーザーへの production 適用時の影響

### 5.1 即時拒否の発生

Plan D の migration を production に適用した瞬間から、既存 stage=4 ユーザーは:
- battles / decks / deck_tunings / shares の **新規書き込み** が拒否される
- 既存データの **閲覧 / 削除** は引き続き可能 (SELECT / DELETE POLICY 変更なし)
- アカウント削除 (`/api/account/delete`) は引き続き可能 (RD-D4-1)
- フィードバック送信 (`feedback` INSERT) は引き続き可能 (RD-D2 で対象外)

### 5.2 通知方針 (要決定)

- 本 plan は **migration 適用前に admin がユーザーへ事前通知するかどうか** を運用判断とする
- 通知する場合の文面例:
  - 「アカウントが停止状態のため、新規の戦績登録・デッキ登録・共有作成ができません。誤判定の場合はフィードバックフォームよりお知らせください。」
- 過去に stage=4 になったが UI 側 BanGuard で既に BAN 画面表示されているユーザーは「実態は既に書き込めない (UI 上)」のため通知不要のケースが多い

### 5.3 smoke test 手順 (production)

```sql
-- 1. テストユーザー (BAN テスト用、staging で事前作成済み) で account_access_state 確認
SELECT public.account_access_state('<stage4_test_uid>');  -- 期待: 'banned'

-- 2. admin 自身 (stage 値に関わらず admin 例外で active)
SELECT public.account_access_state('<admin_uid>');  -- 期待: 'active'

-- 3. RLS smoke test (DO block で「拒否=成功」を検証)
DO $$
BEGIN
  -- SET LOCAL role = 'authenticated';
  -- SET LOCAL request.jwt.claims = '{"sub":"<stage4_test_uid>"}';
  INSERT INTO public.battles (
    user_id, my_deck_id, my_deck_name, opponent_deck_name,
    result, format, game_title
  ) VALUES (
    '<stage4_test_uid>', '<test_deck_id>', 'test deck', 'opp',
    'win', 'ND', 'dm'
  );
  RAISE EXCEPTION 'expected RLS denial, but INSERT succeeded';
EXCEPTION
  WHEN insufficient_privilege OR check_violation THEN
    RAISE NOTICE 'RLS denied as expected';
END $$;
```

(`feedback-trigger-smoke-test` メモ参照: 拒否系 smoke test は DO block で「拒否=成功 / 通った=失敗 RAISE」 rollback 形式)

---

## 6. AuthExpiredError + AuthGuard 運用

### 6.1 動作シナリオ

| シナリオ | 期待挙動 |
|---|---|
| 通常ログイン中 | actions 内部の `if (!user)` 分岐に到達せず、データ取得が成功する |
| JWT 失効後に UI 表示用 action 呼び出し (例: `getRecentBattles`) | `throw AuthExpiredError` → AuthGuard `catch (e) handleAuthExpiredError(e)` 経路で `/auth?next=...` redirect (戦績ゼロ表示にならない) |
| JWT 失効後に重要操作 (例: `recordBattle`) | 同上 |
| JWT 失効後に Optional state (例: `getXConnectionStatus`) | 現状維持 (return null/false)、AuthGuard は発火しない (画面はそのまま表示) |
| catch ブロックで握りつぶし (handleAuthExpiredError 未挿入) | unhandledrejection 経路 2 が safety net で AuthGuard 起動 (ただし dispatch まで遅れる可能性あり) |

### 6.2 next param 安全性 (Plan A integration)

- `pathname + search` を candidate にし、`isSafeInternalPath` (Plan A) で検証
- 外部 URL / `/auth` / `/api` / 制御文字混入 / 二重 encoding は拒否され、`/auth` (next なし) にフォールバック

### 6.3 de-duplication

- AuthGuard の `isRedirecting` ref で同一 redirect target への二重発火を防ぐ
- 経路 1 + 経路 2 + 経路 3 が同時発火しても 1 回しか push されない

---

## 7. ロールバック

### 7.1 緊急時の停止順序

1. **コード rollback**: Cloudflare Deployments で前 deploy に戻す (BanGuard fail-open に依存して全ユーザーアクセス維持)
2. **RPC rollback**: `supabase/rollback/20260528000003_rollback.sql` を staging で確認後 production 適用
3. **RLS rollback**: `supabase/rollback/20260528000002_rollback.sql` 同上
4. **関数 DROP**: `supabase/rollback/20260528000001_rollback.sql` 同上

順序逆 (関数を先に DROP) すると CASCADE で POLICY が消える可能性があるため D-3 → D-2 → D-1 の順序を厳守。

### 7.2 部分 rollback

- D-4 (require-bearer の requireActiveUser) のみ無効化したい場合: `requireActiveUser: false` を全 route で明示
- D-5 (AuthGuard) のみ無効化したい場合: `src/app/layout.tsx` から AuthGuard を外す (AuthExpiredError は throw されるだけになり unhandledrejection でブラウザコンソールに出るのみ)


### 7.3 production 適用順序 (Codex review 2 P1 反映)

新コードと migration の deploy 順序は以下を厳守し、`/api/discord/*` / `/api/admin/*` / `/api/account/delete` が「`account_access_state` 関数が存在しない DB を叩く」事故を避ける:

```
[Step 1] staging migration (D-1 → D-2 → D-3) 適用
         → staging で smoke test (RLS拒否 / RPC拒否 / API 403 / AuthGuard redirect)
[Step 2] D-1 (account_access_state 関数追加) を production DB に **先行適用** (additive expand)
         → 既存コードからは関数が増えるだけで参照されない (=非破壊)
         → AGENTS.md / CLAUDE.md の「コード変更を伴うマイグレーションは原則 main 反映後」の例外規定 (additive expand) に該当
[Step 3] code (dev → main merge → Cloudflare 自動 deploy) を本番反映
         → 新 require-bearer / discord callback / RLS / AuthGuard が稼働
         → このとき D-1 が既に適用済なので account_access_state RPC が成功する
[Step 4] D-2 / D-3 を production DB に適用
         → 書き込み RLS / SECDEF 関数の access gate が有効化
         → stage=4 ユーザーの書き込み拒否が DB レイヤでも機能開始
```

**Step 1 → Step 2 → Step 3 → Step 4 の順序を逆にしない**:
- D-2 / D-3 を先に適用するとコード未反映の旧コード経路が SECDEF 関数の `account_banned` で壊れる
- D-1 を後回しにすると新コードの `account_access_state` RPC が PGRST202 で失敗する (safety net 一時 fallback が発動するが、本来は順序遵守で fallback に頼らない)

### 7.4 順序事故時の safety net

万一 Step 3 (code deploy) が Step 2 (D-1 適用) より先に走った場合の防御として、以下を実装:

- `src/lib/auth/require-bearer.ts` の `account_access_state` 呼び出しで、PostgREST `PGRST202` / "Could not find the function" / "schema cache" / "function ... does not exist" を `isMissingFunctionError()` で判定し、true なら **active fallback** で素通す (`console.warn` で warning 出力)
- `src/app/api/discord/callback/route.ts` の inline 呼び出しでも同じ判定で fallback

fallback 発動中はログに `account_access_state RPC missing (D-1 未適用?)` が出る。これが本番ログで観測されたら D-1 migration 適用漏れなので、即時適用する。fallback は **緊急時の壊れ防止用**であり、長期運用しない。

### 7.5 staging dry-run チェックリスト

- [ ] `\df public.account_access_state` で関数定義が見える
- [ ] `SELECT public.account_access_state(<stage1_uid>)` → `'active'`
- [ ] `SELECT public.account_access_state(<stage4_uid>)` → `'banned'`
- [ ] `SELECT public.account_access_state(<admin_uid_stage4>)` → `'active'` (admin 例外)
- [ ] stage=4 テストユーザーで `INSERT INTO battles ...` が RLS 拒否 (DO block smoke test)
- [ ] stage=4 テストユーザーで `SELECT public.update_my_display_name('test')` が `account_banned` 例外
- [ ] dev preview で stage=4 テストユーザーが `/dm/battle` から戦績登録 → 失敗 + AuthGuard 起動なし (banned UI は BanGuard 経由)
- [ ] dev preview で JWT 強制 expire → AuthGuard が `/auth?next=...` redirect
- [ ] dev preview で再ログイン → 次の JWT expiry でも AuthGuard が再度 redirect (`isRedirecting` リセット)

---

## 8. 関連ファイル

- migration: `supabase/migrations/20260528000001_d1_account_access_state.sql`
- migration: `supabase/migrations/20260528000002_d2_write_rls_access_gate.sql`
- migration: `supabase/migrations/20260528000003_d3_rpc_access_gate.sql`
- rollback: `supabase/rollback/20260528000001_rollback.sql`
- rollback: `supabase/rollback/20260528000002_rollback.sql`
- rollback: `supabase/rollback/20260528000003_rollback.sql`
- helper: `src/lib/auth/require-bearer.ts` (requireActiveUser フィールド)
- helper: `src/lib/errors/auth-expired-error.ts`
- component: `src/components/providers/AuthGuard.tsx`
- BanGuard (touch しない): `src/components/providers/BanGuard.tsx`
- middleware (RD-D6-1 で不要判定): `src/middleware.ts`
