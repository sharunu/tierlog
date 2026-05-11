# 2026-05-11 DBハードニング計画（一般公開前）

## 目的
Supabase Advisor (Performance & Security Lints) の警告を「公開前必須」「公開前推奨」「意図通り」「ユーザーダッシュボード対応」に分類し、公開前に DB/RLS/index/RPC 権限を低リスクで仕上げる。

## スコープ外
- 認証フロー / X / Discord ログインの変更
- アプリコードの機能変更（DB migration と GRANT/REVOKE のみ）
- 新規ゲーム追加・新規テーブル追加

## 入力資料
- `.tmp/Supabase Performance Security Lints (asjqtqxvwipqmtpcatvz).csv` — SECURITY DEFINER 33 件 + auth_leaked_password_protection
- `.tmp/Supabase Performance Security Lints (asjqtqxvwipqmtpcatvz) (1).csv` — `rls_enabled_no_policy` on `discord_oauth_states` 1 件
- `.tmp/Supabase Performance Security Lints (asjqtqxvwipqmtpcatvz) (2).csv` — `auth_rls_initplan` 34 件 + `multiple_permissive_policies` 37 件
- `.tmp/Supabase Performance Security Lints (asjqtqxvwipqmtpcatvz) (3).csv` — `unindexed_foreign_keys` 8 件 + `unused_index` 2 件

staging 側 (Supabase project ref `uqndrkaxmbfjuiociuns`) のスナップショット (2026-05-11 取得):
- `.tmp/Supabase Performance Security Lints (uqndrkaxmbfjuiociuns).csv` — SECURITY DEFINER 33 件 + auth_leaked_password_protection
- `.tmp/Supabase Performance Security Lints (uqndrkaxmbfjuiociuns) (1).csv` — `rls_enabled_no_policy` on `discord_oauth_states` 1 件
- `.tmp/Supabase Performance Security Lints (uqndrkaxmbfjuiociuns) (2).csv` — `auth_rls_initplan` 34 件 + `multiple_permissive_policies` 31 件
- `.tmp/Supabase Performance Security Lints (uqndrkaxmbfjuiociuns) (3).csv` — `unindexed_foreign_keys` 8 件 + `unused_index` 4 件

`.tmp/` は `.gitignore` 済（line 59）なので CSV は commit されない。

## 本番/staging Advisor 比較 (2026-05-11)

| 区分 | production (`asjqtqxvwipqmtpcatvz`) | staging (`uqndrkaxmbfjuiociuns`) | 差分の意味 |
|---|---|---|---|
| **total** | 116 件 | 112 件 | staging が 4 件少ない (主に `multiple_permissive_policies` の差) |
| Security | 35 件 | 35 件 | 完全一致 |
| Performance | 81 件 | 77 件 | staging が 4 件少ない |
| `unindexed_foreign_keys` | 8 件 | 8 件 | 完全一致 — Migration 1 の対象 FK は両 DB 共通 |
| `auth_rls_initplan` | 34 件 | 34 件 | 完全一致 — Migration 2 の `(SELECT auth.uid())` ラップ対象は両 DB 共通 |
| `authenticated_security_definer_function_executable` | 33 件 | 33 件 | 完全一致 — 既存 hardening の方針 (意図的に authenticated callable) は両 DB 共通 |
| `rls_enabled_no_policy` | 1 件 (`discord_oauth_states`) | 1 件 (`discord_oauth_states`) | 完全一致 — Migration 1 の `COMMENT ON TABLE` 対象は両 DB 共通 |
| `multiple_permissive_policies` | 37 件 | 31 件 | 件数差はあるが**対象テーブルは同じ 7 テーブル** (battles / decks / deck_tunings / profiles / feedback / quality_score_snapshots / quality_scoring_settings)。production 側で評価ロール数が staging より多いことによる重複カウント差と推定。**Migration 3 の整理方針 (FOR ALL split + SELECT 統合) は変更不要** |
| `unused_index` | 2 件 (`idx_feedback_status_created_at`, `alerts_game_idx`) | 4 件 (上記 2 件 + `idx_battles_tuning_id`, `idx_shares_created_at`) | staging で +2 件。**staging は production より使用統計の信頼性がさらに低い** (低トラフィック)。今回は両 DB とも DROP せず公開後の production 利用統計で再評価する方針 (後述 [unused index] 参照) |
| `auth_leaked_password_protection` | 1 件 | 1 件 | 完全一致 — **今回は保留** (将来 Email provider 本格運用時に再検討、Resolved Decisions [auth_leaked_password] 参照) |

**結論**: 既知の 4 件 mechanical 修正対象 (FK index / auth_rls_initplan / multiple_permissive_policies / discord_oauth_states COMMENT) は production / staging で完全一致または対象テーブル一致。**PR1/PR2/PR3 分割方針は変更なし**。staging で migration を先に焼き込んでも、production 適用時に対象が変わるリスクは低い (unused_index の差は今回スコープ外)。

## 現状認識（既適用 hardening）

以下は既に migrations/ に入って production 反映済（CLAUDE.md 既定の `dev → main → user OK → db push` 手順で適用）:
- `20260424000001_security_hardening_additive.sql` — profiles 用 RPC 4 本 / `discord_oauth_states` テーブル / `is_team_member` 上書き / Team RPC 8 本に `is_team_member` ガード + `SET search_path = ''` + `public.` 修飾 / share-images storage policy 追加
- `20260424000002_security_hardening_restrictive.sql` — `profiles` 直 UPDATE policy 削除と UPDATE REVOKE / 旧 share-images policy 削除
- `20260426005408_secdef_search_path.sql` — `is_admin_user` / `auto_add_opponent_deck` / `recalculate_opponent_decks` / `run_daily_opponent_deck_batch` / `sync_team_membership` を `SET search_path = ''` 化（`normalize_battle_deck_names` の同 hardening は `20260426005407_strengthen_battles_rls.sql` で初期定義時に完了済）
- `20260426050849_secdef_search_path_phase2.sql` — 公開 SECDEF RPC 11 本（`get_environment_*` / `get_global_*` / `get_personal_*` / `get_deck_trend_range` / `delete_own_account` / `get_opponent_deck_suggestions`）に同じ hardening
- `20260509000001_secure_rpc_permissions.sql` — Limitless / Detection / Quality scoring 系を `service_role` 専用 + 公開 wrapper + cron wrapper の 3 段構造に再編。`auth.role() = 'service_role'` で bypass、`auth.uid() IS NULL` を bypass 条件にしない設計に統一
- `20260509000004_secdef_hardening_phase_a.sql` — admin SECDEF 3 本 / Team RPC 8 本 / trigger 関数 2 本 / `rls_auto_enable` の `REVOKE PUBLIC,anon,service_role` + `GRANT authenticated`、`Public can read share images` policy 削除

つまり SECDEF 関連は既に「`SET search_path = ''` + `public.` 修飾 + `REVOKE PUBLIC,anon` + 必要な role だけに `GRANT EXECUTE`」の形式に揃っている。残る Advisor 警告は **「authenticated に EXECUTE を残しているのが INFO/WARN で報告される」** という構造的なものが大半で、本当に追加修正が必要なのは下記 4 種類のみ。

## 1. Advisor 警告の分類

### A. 公開前に必ず直す（true positive、自前 migration で対応）

| 警告 | 件数 | 内容 | 対応 |
|---|---|---|---|
| `auth_rls_initplan` | 34 | RLS policy 内で `auth.uid()` を行ごとに再評価している（Section 2 列挙の 18 テーブル分、policy 数 34 本） | `(SELECT auth.uid())` でラップ。挙動互換、性能のみ改善 |
| `multiple_permissive_policies` | 37 | `admin_select_*` PERMISSIVE policy (5 テーブル) と `admin_manage_quality_snapshots` / `admin_manage_quality_settings` の FOR ALL policy (2 テーブル) が user 自己 SELECT policy と OR 評価されてしまう（計 7 テーブル — battles / decks / deck_tunings / profiles / feedback / quality_score_snapshots / quality_scoring_settings、各 PERMISSIVE 重複が複数ロールで重複カウントされて計 37 件） | `admin_select_*` を RESTRICTIVE には出来ない（RESTRICTIVE は AND になり全ユーザー閉鎖される）。代わりに **既存 policy を 1 本に統合**（`USING (user_id = (SELECT auth.uid()) OR EXISTS(SELECT 1 FROM profiles WHERE id = (SELECT auth.uid()) AND is_admin = true))`）して permissive 重複を解消 |
| `unindexed_foreign_keys` | 8 | covering index がない FK | `CREATE INDEX IF NOT EXISTS ...` 追加（テーブル: `detection_alerts` × 2, `feedback`, `quality_admin_bonus`, `shares`, `team_members`, `user_stage_history` × 2） |

### B. 公開前にできれば直す（low priority、後回し可）

| 警告 | 件数 | 内容 | 対応 |
|---|---|---|---|
| `unused_index` | production: 2 件 (`idx_feedback_status_created_at` / `alerts_game_idx`) / staging: 4 件 (上記 + `idx_battles_tuning_id` / `idx_shares_created_at`) | 上記 production 2 + staging 追加 2 = 計 4 index が unused 判定 | **全件保留**。production / staging で差分あり (staging は使用統計の信頼性がさらに低い)。本 plan の migration では一切 DROP しない。**公開後 1 ヶ月程度の production 利用統計**で再評価する |

### C. 意図通りなので無視してよい（false positive、Advisor の suppress 機能で対応）

| 警告 | 件数 | 対象 | なぜ false positive か |
|---|---|---|---|
| `rls_enabled_no_policy` | 1 | `public.discord_oauth_states` | `20260424000001` で意図的に RLS 有効 + policy 未作成 + `REVOKE ALL FROM PUBLIC, anon, authenticated`。`service_role` 経由（API route `/api/discord/callback` 等）のみアクセスする設計。RLS bypass + 権限明示の二重防御で安全 |
| `authenticated_security_definer_function_executable` | 33 | SECDEF 33 本（後述「3. SECURITY DEFINER RPC 棚卸し」参照） | 全関数を「`SET search_path = ''` + 完全修飾 + 必要最小限の GRANT」に hardening 済。authenticated に EXECUTE を残しているのは、アプリが anon key + Supabase auth session（authenticated role）から REST 呼び出しする設計のため。Advisor の lint は「authenticated callable な SECDEF はレビューしろ」という INFO 喚起であり、関数ごとに用途確認すれば許容 |

本 plan ではこれらの警告に対し **migration の `COMMENT ON TABLE` / `COMMENT ON FUNCTION` で意図を DB カタログに記録する**方針を採る (Resolved Decisions [lint silence] 参照)。`COMMENT` は Advisor lint scan を直接抑止しないため Advisor INFO/WARN は残る可能性を許容する。Supabase Dashboard 上の「Lint Exception」(`lint_ignore` 登録) は **必須作業にしない** (git 履歴に意図を残せないため、SQL COMMENT を一次ストアとする)。

### D. Dashboard 設定でユーザーが対応する

| 警告 | 内容 | 対応 |
|---|---|---|
| `auth_leaked_password_protection` | HaveIBeenPwned 漏洩 password チェック無効 | **今回は保留**。将来 Email provider / Email ログインを本格運用する段階で「Enable leaked password protection」を ON にするかを再検討する。公開前のユーザー作業としては要求しない（公式 docs: https://supabase.com/docs/guides/auth/password-security ） |

本プロジェクトは email/password 認証機能 (`src/app/auth/page.tsx` の `signInWithPassword` / `signUp`) はコード上は実装済みだが、Supabase Auth の Email provider 設定 (SMTP / template 等) を本格運用に乗せるかは別判断。**今回は保留**し、将来 Email provider / Email ログインを本格運用する段階で「Enable leaked password protection」を ON にするかを再検討する。公開前のユーザー作業としては要求しない。

## 2. 低リスクで先にやる migration 案

### Migration 1: FK 用 covering index 追加（性能改善、低リスク）

ファイル名（案）: `supabase/migrations/20260511000001_fk_indexes.sql`

```sql
-- Advisor: unindexed_foreign_keys 警告 8 件への対応
-- CREATE INDEX CONCURRENTLY は migration トランザクション内では使えないため通常 CREATE INDEX を使う。
-- すべて IF NOT EXISTS で冪等化。

CREATE INDEX IF NOT EXISTS detection_alerts_resolved_by_idx
  ON public.detection_alerts(resolved_by);
CREATE INDEX IF NOT EXISTS detection_alerts_user_id_idx
  ON public.detection_alerts(user_id);
CREATE INDEX IF NOT EXISTS feedback_user_id_idx
  ON public.feedback(user_id);
CREATE INDEX IF NOT EXISTS quality_admin_bonus_granted_by_idx
  ON public.quality_admin_bonus(granted_by);
CREATE INDEX IF NOT EXISTS shares_user_id_idx
  ON public.shares(user_id);
CREATE INDEX IF NOT EXISTS team_members_user_id_idx
  ON public.team_members(user_id);
CREATE INDEX IF NOT EXISTS user_stage_history_changed_by_idx
  ON public.user_stage_history(changed_by);
CREATE INDEX IF NOT EXISTS user_stage_history_user_id_idx
  ON public.user_stage_history(user_id);
```

**確認事項（plan-critic / ユーザー判断）:**
- index 名は `<table>_<column>_idx` で統一。既存 index に `alerts_game_idx` のような短縮名もあるが、衝突回避と一覧性のため fully qualified にする
- 通常 `CREATE INDEX` は書き込みを一時ブロックし得る (`SHARE` lock を取り並列の INSERT/UPDATE/DELETE がブロックされる、`CONCURRENTLY` を使えば回避できるが migration トランザクション内では使用不可)。公開前でデータ量が小さいため低リスクだが、production 適用は低トラフィック時に実施する
- 既存 index の重複は `IF NOT EXISTS` で防止

### Migration 2: RLS policy の `(SELECT auth.uid())` 化（性能改善、挙動互換）

ファイル名（案）: `supabase/migrations/20260511000002_rls_auth_init_plan.sql`

対象 policy 34 件のうち、`auth.uid() = user_id` パターンの典型例:

```sql
-- 18 テーブルの 34 policy を CREATE OR REPLACE は使えないので
-- DROP POLICY + CREATE POLICY ペアで書き換える。
-- DROP-CREATE 間は同一トランザクション内なのでアクセス断は発生しない。

-- battles
DROP POLICY IF EXISTS "Users can read own battles" ON public.battles;
CREATE POLICY "Users can read own battles" ON public.battles
  FOR SELECT USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own battles" ON public.battles;
CREATE POLICY "Users can insert own battles" ON public.battles
  FOR INSERT WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = battles.my_deck_id
        AND d.user_id = (SELECT auth.uid())
        AND d.format = battles.format
        AND d.game_title = battles.game_title
    )
    AND EXISTS (
      SELECT 1 FROM public.opponent_deck_settings s
      WHERE s.format = battles.format
        AND s.game_title = battles.game_title
    )
    AND (
      battles.tuning_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.deck_tunings t
        WHERE t.id = battles.tuning_id
          AND t.deck_id = battles.my_deck_id
      )
    )
  );

DROP POLICY IF EXISTS "Users can update own battles" ON public.battles;
CREATE POLICY "Users can update own battles" ON public.battles
  FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.decks d
      WHERE d.id = battles.my_deck_id
        AND d.user_id = (SELECT auth.uid())
        AND d.format = battles.format
        AND d.game_title = battles.game_title
    )
    AND EXISTS (
      SELECT 1 FROM public.opponent_deck_settings s
      WHERE s.format = battles.format
        AND s.game_title = battles.game_title
    )
    AND (
      battles.tuning_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.deck_tunings t
        WHERE t.id = battles.tuning_id
          AND t.deck_id = battles.my_deck_id
      )
    )
  );

DROP POLICY IF EXISTS "Users can delete own battles" ON public.battles;
CREATE POLICY "Users can delete own battles" ON public.battles
  FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- decks（同様パターン、SELECT/INSERT/UPDATE/DELETE 4 本）
-- profiles（"Users can view own profile" 1 本）
-- deck_tunings（"Users can manage own deck tunings" 1 本、FOR ALL）
-- discord_connections（read/insert/update/delete 4 本）
-- team_members（"Team members can read team members" / "Users can update own membership" / "Users can delete own membership" 3 本）
-- teams（"Team members can read team" 1 本）
-- feedback（"Users can insert own feedback" / "Users can read own feedback" 2 本）
-- shares（"Authenticated users can create own shares" 1 本）
-- opponent_deck_master（"Authenticated users can read decks" / "Admins can insert" / "Admins can update" / "Admins can delete" 4 本）
-- opponent_deck_settings（"Admins can update settings" 1 本）
-- user_stage_history（"admin_manage_stage_history" 1 本）
-- detection_rules（"admin_manage_detection_rules" 1 本）
-- detection_alerts（"admin_manage_detection_alerts" 1 本）
-- quality_scoring_rules（"admin_manage_quality_rules" 1 本）
-- quality_score_snapshots（"admin_manage_quality_snapshots" / "user_read_own_quality_snapshot" 2 本）
-- quality_admin_bonus（"admin_manage_quality_bonus" 1 本）
-- quality_scoring_settings（"admin_manage_quality_settings" 1 本）
```

**注意:**
- `auth.uid() = id`（profiles）や `user_id = auth.uid()` も同様に `(SELECT auth.uid())` でラップ
- admin policy 内の `is_admin_user()` 呼び出しも `(SELECT is_admin_user())` でラップする（同じ initplan 問題）
- 既存の各 migration から policy 定義を起点としてコピーし、`auth.uid()` だけを置換する。**WHERE 句や USING 条件のロジックは変えない**（挙動互換）

### Migration 3: `multiple_permissive_policies` の整理（admin policy 統合）

ファイル名（案）: `supabase/migrations/20260511000003_consolidate_admin_select_policies.sql`

```sql
-- 対象 7 テーブル: battles / decks / deck_tunings / profiles / feedback / quality_score_snapshots / quality_scoring_settings
-- ・battles / decks / deck_tunings / profiles / feedback は admin_select_* (FOR SELECT, 20260412000005) を user 自己 SELECT policy に統合
-- ・quality_score_snapshots は admin_manage_quality_snapshots (FOR ALL) と user_read_own_quality_snapshot (FOR SELECT) の SELECT 重複を統合
--   注意: admin_manage_quality_snapshots は FOR ALL のため、SELECT のみ user 側に統合し、INSERT/UPDATE/DELETE 用に
--   admin 専用 policy を別途 CREATE する必要がある (run_quality_scoring の snapshot upsert 経路が壊れないように)
-- ・quality_scoring_settings は admin_manage_quality_settings (FOR ALL) と user_read_premium_ui_setting (FOR SELECT) の SELECT 重複を統合
--   注意: 同様に admin の INSERT/UPDATE/DELETE policy を別途残す必要がある (admin UI からの settings 更新が壊れないように)
-- RESTRICTIVE には変換しない（PERMISSIVE 同士の OR 評価を 1 本にする方が読み手にも分かりやすい）

-- battles
DROP POLICY IF EXISTS admin_select_battles ON public.battles;
DROP POLICY IF EXISTS "Users can read own battles" ON public.battles;
CREATE POLICY "Users can read own battles" ON public.battles
  FOR SELECT USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_admin_user())
  );

-- decks / profiles / feedback は user 自己 SELECT policy が独立しているので、SELECT-only 統合パターン (battles と同じ) で OK
-- deck_tunings だけは user 自己 policy が FOR ALL (USING/WITH CHECK ともに deck 所有 EXISTS) のため、battles 流の単純 SELECT 統合では privilege escalation になる
--   → quality_score_snapshots/quality_scoring_settings と同じ「FOR ALL を SELECT consolidated + 所有者ベース INSERT/UPDATE/DELETE 3 本」に分割する
--   具体 SQL (Migration 3 末尾に追加):
--     DROP POLICY IF EXISTS admin_select_deck_tunings ON public.deck_tunings;
--     DROP POLICY IF EXISTS "Users can manage own deck tunings" ON public.deck_tunings;
--     CREATE POLICY "Users can read own deck tunings" ON public.deck_tunings
--       FOR SELECT USING (
--         EXISTS (SELECT 1 FROM public.decks d WHERE d.id = deck_tunings.deck_id AND d.user_id = (SELECT auth.uid()))
--         OR (SELECT public.is_admin_user())
--       );
--     CREATE POLICY "Users can insert own deck tunings" ON public.deck_tunings
--       FOR INSERT WITH CHECK (
--         EXISTS (SELECT 1 FROM public.decks d WHERE d.id = deck_tunings.deck_id AND d.user_id = (SELECT auth.uid()))
--       );
--     CREATE POLICY "Users can update own deck tunings" ON public.deck_tunings
--       FOR UPDATE USING (
--         EXISTS (SELECT 1 FROM public.decks d WHERE d.id = deck_tunings.deck_id AND d.user_id = (SELECT auth.uid()))
--       ) WITH CHECK (
--         EXISTS (SELECT 1 FROM public.decks d WHERE d.id = deck_tunings.deck_id AND d.user_id = (SELECT auth.uid()))
--       );
--     CREATE POLICY "Users can delete own deck tunings" ON public.deck_tunings
--       FOR DELETE USING (
--         EXISTS (SELECT 1 FROM public.decks d WHERE d.id = deck_tunings.deck_id AND d.user_id = (SELECT auth.uid()))
--       );
-- quality_score_snapshots は admin / user_read_own の 2 本を 1 本に統合
-- quality_scoring_settings は admin / user_read_premium_ui_setting の 2 本を 1 本に統合（読み取り権限の WHERE は元 policy 通り key = 'premium_ui_visible' を維持。実体: supabase/migrations/20260416000001_premium_ui_toggle.sql）

-- quality_score_snapshots: FOR ALL を SELECT consolidated + admin write 3 本に分離する具体 SQL
DROP POLICY IF EXISTS admin_manage_quality_snapshots ON public.quality_score_snapshots;
DROP POLICY IF EXISTS user_read_own_quality_snapshot ON public.quality_score_snapshots;
CREATE POLICY user_read_own_quality_snapshot ON public.quality_score_snapshots
  FOR SELECT USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_admin_user())
  );
CREATE POLICY admin_insert_quality_snapshots ON public.quality_score_snapshots
  FOR INSERT WITH CHECK ((SELECT public.is_admin_user()));
CREATE POLICY admin_update_quality_snapshots ON public.quality_score_snapshots
  FOR UPDATE USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));
CREATE POLICY admin_delete_quality_snapshots ON public.quality_score_snapshots
  FOR DELETE USING ((SELECT public.is_admin_user()));

-- quality_scoring_settings: 同様に FOR ALL を SELECT consolidated + admin write 3 本に分離
DROP POLICY IF EXISTS admin_manage_quality_settings ON public.quality_scoring_settings;
DROP POLICY IF EXISTS user_read_premium_ui_setting ON public.quality_scoring_settings;
CREATE POLICY user_read_premium_ui_setting ON public.quality_scoring_settings
  FOR SELECT USING (
    key = 'premium_ui_visible'
    OR (SELECT public.is_admin_user())
  );
CREATE POLICY admin_insert_quality_settings ON public.quality_scoring_settings
  FOR INSERT WITH CHECK ((SELECT public.is_admin_user()));
CREATE POLICY admin_update_quality_settings ON public.quality_scoring_settings
  FOR UPDATE USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));
CREATE POLICY admin_delete_quality_settings ON public.quality_scoring_settings
  FOR DELETE USING ((SELECT public.is_admin_user()));
```

**判断要事項（plan-critic に escalate 予定）:**
- 統合パターン A: 上記 `OR is_admin_user()`（推奨、最少手数）
- 統合パターン B: admin policy を `AS RESTRICTIVE` に変換 → 全 SELECT が `is_admin_user() OR user_id = auth.uid()` の AND で評価されることになるので **NG**（admin が他人を見られなくなる）
- 統合パターン C: admin 用に独立した SECDEF RPC `admin_get_all_battles()` 等を作り、admin policy 自体を削除 → 大規模リファクタになるので公開前スコープ外

→ **パターン A 採用**

### Migration 4: SECURITY DEFINER RPC の棚卸しに基づく権限再確認

「公開前必須」のものはほぼ全て既存 hardening migrations で対応済（前述「現状認識」参照）。本 plan で **新規 migration が必要なのは「3. SECURITY DEFINER RPC 棚卸し」の category D に該当する is_team_member のみ**（Migration 5 で実施）。

### Migration 5: is_my_team_member(p_team_id) wrapper 新設 + is_team_member authenticated REVOKE

ファイル名（案）: `supabase/migrations/20260511000005_is_team_member_hardening.sql`

```sql
-- Resolved Decisions [team_member] 確定事項:
-- - public.is_my_team_member(p_team_id uuid) を新設し、内部で auth.uid() を使って
--   現在ログイン中ユーザーだけを判定する自己限定 wrapper にする
-- - 既存 public.is_team_member(p_team_id uuid, p_user_id uuid) は
--   任意 user_id 判定が可能なため authenticated から EXECUTE を剥奪 (membership oracle 防止)
-- - 既存 RLS policy / Team RPC 内部の is_team_member 呼び出しは SECURITY DEFINER 内のため
--   owner 権限で評価され、authenticated 剥奪後も機能維持される (要 staging 検証)

CREATE OR REPLACE FUNCTION public.is_my_team_member(p_team_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE team_id = p_team_id AND user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.is_my_team_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_my_team_member(uuid) TO authenticated;

-- 既存 RLS policy (team_members / teams) を is_my_team_member(team_id) 呼び出しに差し替える。
-- これをやらずに REVOKE すると、policy 式は呼び出し側ロール (authenticated) の権限で評価されるため
-- authenticated ユーザーの team_members / teams SELECT が失敗する。
DROP POLICY IF EXISTS "Team members can read team members" ON public.team_members;
CREATE POLICY "Team members can read team members"
  ON public.team_members FOR SELECT
  USING (public.is_my_team_member(team_id));

DROP POLICY IF EXISTS "Team members can read team" ON public.teams;
CREATE POLICY "Team members can read team"
  ON public.teams FOR SELECT
  USING (public.is_my_team_member(id));

-- Team RPC 8 本内部の is_team_member(team_id, auth.uid()) は SECURITY DEFINER 関数本体内なので
-- owner 権限で評価される。authenticated REVOKE 後も維持される。
REVOKE EXECUTE ON FUNCTION public.is_team_member(uuid, uuid) FROM authenticated;
```

**目的の明確化**: 本 Migration は Advisor 警告 `authenticated_security_definer_function_executable` を 0 件にすることが目的ではない。新設する `is_my_team_member(p_team_id)` も `SECURITY DEFINER` で authenticated callable のため、同 lint の対象として残る (意図通りの設計)。**目的は任意の `(team_id, user_id)` ペアを問い合わせられる membership oracle (= 既存 `is_team_member(uuid, uuid)`) を、`auth.uid()` ベースの自己限定 wrapper に置き換えることで攻撃面を縮小すること**。

**staging 検証必須項目** (Resolved Decisions [team_member] 参照):
- Discord 連携済みユーザーのチーム表示 (`/dm/stats/team`) が動く
- チーム統計 (get_team_*_stats_range 系) が動く
- メンバー一覧 (get_team_members / get_team_member_summaries) が動く
- team_members / teams テーブルの RLS policy (Migration 5 で `is_my_team_member(team_id)` に置換後) が壊れない

## 3. SECURITY DEFINER RPC の棚卸し（33 関数）

CSV (main).csv 行 2–34 に列挙される `authenticated_security_definer_function_executable` 警告の対象 33 関数を、用途別に分類。

### A. `authenticated` に開ける必要がある（GRANT EXECUTE TO authenticated は維持、コメントで意図記録）

ユーザー自身のデータ操作・読み取り。`auth.uid()` を関数内で参照するため `SECURITY DEFINER` が必須（RLS bypass で `WHERE user_id = auth.uid()` フィルタを内部実装）。

- `update_my_display_name(p_display_name text)`
- `sync_my_x_connection()`
- `clear_my_x_connection()`
- `delete_own_account()`
- `auto_add_opponent_deck(p_deck_name text, p_format text, p_game_title text)`
- `get_opponent_deck_suggestions(p_format text)`
- `get_environment_deck_shares(p_days integer, p_format text)`
- `get_environment_deck_shares_range(p_start_date date, p_end_date date, p_format text)`
- `get_personal_environment_shares_range(p_start_date date, p_end_date date, p_format text)`
- `get_global_my_deck_stats_range(p_start_date date, p_end_date date, p_format text, p_max_stage integer)`
- `get_global_opponent_deck_stats_range(p_start_date date, p_end_date date, p_format text, p_max_stage integer)`
- `get_global_deck_detail_stats(p_deck_name text, p_format text, p_start_date date, p_end_date date, p_max_stage integer)`
- `get_global_opponent_deck_detail_stats(p_opponent_deck_name text, p_format text, p_start_date date, p_end_date date, p_max_stage integer)`
- `get_global_turn_order_stats_range(p_start_date date, p_end_date date, p_format text, p_max_stage integer)`
- `get_deck_trend_range(p_start_date date, p_end_date date, p_format text, p_user_id uuid, p_max_stage integer)`

→ **追加 migration 不要**。Advisor の lint exception 登録のみ（D 分類）。

### B. admin check があるので許容（GRANT EXECUTE TO authenticated は維持、内部で admin 判定）

関数の先頭で `EXISTS(SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)` を確認。非 admin は `RAISE EXCEPTION` で拒否される。

- `admin_update_user_stage(p_user_id uuid, p_new_stage integer, p_reason text)`
- `get_users_for_admin()`
- `get_user_detail_for_admin(p_user_id uuid)`
- `update_feedback_status(p_feedback_id uuid, p_status text)`
- `calculate_quality_score(p_user_id uuid)` — service_role OR admin
- `run_quality_scoring(p_auto_update boolean)` — service_role OR admin
- `run_detection_scan()` — service_role OR admin
- `recalculate_opponent_decks(p_format text, p_game_title text)` — admin 専用

→ **追加 migration 不要**。Advisor lint exception のみ。

### C. Team RPC（is_team_member ガードあり、許容）

`is_team_member(team_id, auth.uid())` を先頭でチェックし、所属外は拒否。

- `get_team_my_deck_stats_range(p_team_id uuid, p_user_id uuid, p_start_date date, p_end_date date, p_format text)`
- `get_team_opponent_deck_stats_range(p_team_id uuid, p_user_id uuid, p_start_date date, p_end_date date, p_format text)`
- `get_team_deck_detail_stats(p_team_id uuid, p_deck_name text, p_format text, p_user_id uuid, p_start_date date, p_end_date date)`
- `get_team_opponent_deck_detail_stats(p_team_id uuid, p_opponent_deck_name text, p_format text, p_user_id uuid, p_start_date date, p_end_date date)`
- `get_team_turn_order_stats_range(p_team_id uuid, p_user_id uuid, p_start_date date, p_end_date date, p_format text)`
- `get_team_member_summaries(p_team_id uuid)`
- `get_team_deck_trend_range(p_team_id uuid, p_user_id uuid, p_start_date date, p_end_date date, p_format text)`
- `get_team_members(p_team_id uuid)`

→ **追加 migration 不要**。lint exception のみ。

### D. 追加調査が必要 / 判断要（plan-critic / ユーザー判断にエスカレ）

- **`is_admin_user()`** — `src/` からは直接呼ばれていない（database.types.ts に型のみ）。RLS policy と他 SECDEF 内でのみ参照される。`GRANT EXECUTE TO authenticated` は **REST 経由で「自分が admin か」を返す関数** として露出している。
  - **判断確定 (Resolved Decisions 参照): 現状維持**。RLS policy 内で admin 判定に使っており、authenticated から EXECUTE を外すと admin 系 RLS が壊れる可能性。関数は auth.uid() の自分自身についてしか返さないので他ユーザー情報漏洩なし。authenticated GRANT は意図的な例外として扱い、今回の migration 対象には含めない。

- **`is_team_member(p_team_id uuid, p_user_id uuid)`** — 同様に RLS policy + 他 SECDEF 内でのみ使用。任意の `(team_id, user_id)` ペアを投げて所属判定できる「membership oracle」として露出している。`20260424000001` のコメントで「anon からの membership oracle 利用を防ぐ」目的で `REVOKE ALL FROM PUBLIC, anon` 済。authenticated には現状 GRANT 済。
  - **判断確定 (Resolved Decisions 参照): wrapper 新設 + REVOKE**。`public.is_my_team_member(p_team_id uuid)` を新設し、関数内で `auth.uid()` を使って現在ログイン中ユーザーだけを判定するように絞る。既存 `is_team_member(uuid, uuid)` は任意 user_id 判定が可能なため authenticated から EXECUTE を剥奪。RLS policy / Team RPC 内部の `is_team_member` 呼び出しは SECURITY DEFINER 内のため owner 権限で動き、authenticated 剥奪後も評価は維持される (要 staging 検証)。
  - **追加 migration が必要** (下記 Section 2 Migration 5 で詳述)。

以上の確定により、SECDEF 33 関数のうち追加変更が必要なのは is_team_member の wrapper + REVOKE 1 件のみ。残り 32 関数は **追加変更不要**。

## 4. Migration 設計方針

### 既存挙動を変えない
- すべての DROP POLICY → CREATE POLICY は **同一 SELECT 条件のロジック** を保持。`auth.uid()` を `(SELECT auth.uid())` でラップするだけ
- index 追加は read/write 挙動に影響なし
- admin policy 統合は OR 合成（A の維持）でセマンティクス不変

### staging 適用 → dev preview 動作確認 → main 反映 → production 適用の順序
CLAUDE.md / AGENTS.md の運用ルール通り:
1. dev ブランチで migration ファイル作成 → push
2. Cloudflare が dev preview をビルド（コード変更なしなので影響は小さい）
3. staging Supabase DB に migration 適用（`npx supabase db push --db-url "$STAGING_DB_URL"`）
4. `https://dev-duepure-tracker.jianrenzhongtian7.workers.dev` で主要画面が動くことをユーザーが目視確認
5. ユーザーの「本番反映」明示指示後、main マージ → push
6. **本番デプロイ完了後**、production Supabase DB に migration 適用（順序逆転は CLAUDE.md で禁止）

> **CLAUDE.md 抜粋**:
> > コード変更を伴うマイグレーションは必ず `main` への本番反映が完了してから実行する — 順序を逆にすると DB 側だけ先に新スキーマになり、prod コードが追従していない状態で本番が壊れる

本 plan の migration はコード変更を伴わない (SQL 単独) で、policy 名変更は Supabase 型ジェネレータの参照対象 (pg_proc / pg_attribute) には影響しないため `src/lib/supabase/database.types.ts` の再生成は不要。Migration 5 で新設する `is_my_team_member(uuid)` はサーバ側 RLS / SECDEF 内部からのみ参照され、クライアント TypeScript からは呼ばれないため database.types.ts への反映も任意。なお `npm run cf-typegen` は wrangler の `cloudflare-env.d.ts` 生成コマンドで、DB schema 変更とは無関係である点に注意。

### rollback 方針
- 各 migration の末尾に rollback SQL をコメントで記載（`20260424000002` / `20260509000004` 等の既存パターン踏襲）
- FK index 追加は `DROP INDEX IF EXISTS ...` で即座に戻せる
- policy 書き換えは「旧 policy 再 CREATE」を rollback SQL に書く（旧 `auth.uid() = user_id` 形式）
- admin policy 統合の rollback は旧 `admin_select_*` policy + 旧 user policy の 2 本に戻す
- Cloudflare 側 rollback は Dashboard → Deployments → Rollback ボタン（数秒）

### 検証 SQL（Claude が自前で MCP 経由で実施）
staging 適用後・production 適用後の両方で:

```sql
-- 1. 全 policy 一覧 (auth.uid 直書きが残っていないことを確認)
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%')
  AND qual NOT LIKE '%(SELECT auth.uid())%';
-- → 0 行であること（書き換え漏れ検出）

-- 2. multiple_permissive_policies が消えたか (該当 7 テーブル の SELECT policy 数)
SELECT tablename, COUNT(*) FILTER (WHERE cmd = 'SELECT' OR cmd = 'ALL')
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('battles', 'decks', 'deck_tunings', 'profiles', 'feedback',
                    'quality_score_snapshots', 'quality_scoring_settings')
GROUP BY tablename;
-- → 各テーブル 1 行（OR 合成済）

-- 3. FK index がついたか
SELECT t.relname AS table_name, c.conname AS fk_name,
       (SELECT COUNT(*) FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
        WHERE i.indrelid = t.oid
          AND array_to_string(i.indkey::int[], ',') LIKE c.conkey::text || '%') AS index_count
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
WHERE c.contype = 'f' AND t.relnamespace = 'public'::regnamespace
  AND t.relname IN ('detection_alerts','feedback','quality_admin_bonus','shares','team_members','user_stage_history');
-- → 全 FK に index_count >= 1

-- 4. Advisor 警告再走査 (Supabase Dashboard → Database → Linter → Re-run)
-- → 0 件目標: auth_rls_initplan / multiple_permissive_policies / unindexed_foreign_keys
-- → 残存許容 (意図通り、0 件目標から除外):
--    - rls_enabled_no_policy on discord_oauth_states (SQL COMMENT で意図記録、Advisor INFO は scan で残る可能性を許容)
--    - authenticated_security_definer_function_executable on is_my_team_member
--      (Migration 5 で新設、authenticated callable は仕様、目的は任意 user_id 判定の membership oracle 廃止)
```

Supabase MCP `mcp__plugin_supabase_supabase__execute_sql` か Dashboard Linter で確認。Linter 再走査は実機 UI 操作が必要（**ユーザー作業**）。

### `npm run lint` / build 検証
本 migration はコード変更なしのため、`npm run lint` で警告が増えることはない想定。念のため staging 適用後に:
- `npm run lint`（**Claude 自前**）
- `npx opennextjs-cloudflare build`（**Claude 自前**、Workers 上限 10 MiB 越えがないこと、Phase E2 の bundle 増分注意）
- `curl https://dev-duepure-tracker.jianrenzhongtian7.workers.dev/` → 200 確認（**Claude 自前**）
- 主要画面（`/dm/home`, `/dm/battle`, `/dm/stats/global`, `/dm/stats/team`, `/account`, `/admin/users`）のブラウザ実機操作（**ユーザー作業**）

## 5. 実装前確認事項（ユーザー / plan-critic に判断依頼）

### Q1. 適用範囲のスコープ確認
本 plan の migration は **5 種類**（FK index / RLS init plan / admin policy 統合 / D 分類 / is_team_member hardening）。

**判断確定 (Resolved Decisions 参照): 3 PR 分割**
- **PR 1**: Migration 1 (FK index 追加)。低リスク性能改善のみ
- **PR 2**: Migration 2 (auth_rls_initplan の `(SELECT auth.uid())` ラップ)。挙動互換、性能改善
- **PR 3**: Migration 3 (multiple permissive policies 整理) + Migration 5 (is_team_member hardening + is_my_team_member 新設) + Migration 4 (SECDEF 棚卸し最終確認)。破壊リスクがあるため staging で重点検証

各 PR ごとに migration を分け、staging DB へ適用して検証し、Advisor 差分を確認、問題なければ次へ進む。

### Q2. `is_admin_user()` の authenticated EXECUTE を REVOKE するか
**判断確定 (Resolved Decisions [is_admin REVOKE] 参照): 現状維持**。RLS policy 内で admin 判定に使っており、authenticated から EXECUTE を外すと admin 系 RLS が壊れる可能性。関数は auth.uid() の自分自身についてしか返さないので他ユーザー情報漏洩なし。authenticated GRANT は意図的な例外として扱う。Advisor 上は「意図的に許容する SECURITY DEFINER helper」として分類。

### Q3. `is_team_member(p_team_id, p_user_id)` の authenticated EXECUTE を REVOKE するか
**判断確定 (Resolved Decisions [team_member] 参照): wrapper 新設 + REVOKE**。`public.is_my_team_member(p_team_id uuid)` を新設し、関数内で `auth.uid()` を使って現在ログイン中ユーザーだけを判定する。既存 `is_team_member(uuid, uuid)` は authenticated から EXECUTE 剥奪。RLS policy / Team RPC 内部参照は SECURITY DEFINER 内のため owner 権限で評価され機能維持。具体 SQL は Migration 5 参照。staging で Team RPC (get_team_*) 動作検証必須。

### Q4. `unused_index` を削除するか (production 2 件 / staging 4 件 差分あり)
**判断確定 (Resolved Decisions [unused index] 参照): 公開後に再評価**。production CSV では 2 件 (`idx_feedback_status_created_at` / `alerts_game_idx`)、staging CSV ではさらに 2 件加わって計 4 件 (`idx_battles_tuning_id` / `idx_shares_created_at`) が unused 判定。staging は production より使用統計の信頼性が低い (低トラフィック) ため、staging の追加 2 件も含めて全件保留。`idx_feedback_status_created_at` は管理画面や将来のフィードバック確認で使う可能性、`alerts_game_idx` は検知アラート / ゲーム別管理で使う可能性、`idx_battles_tuning_id` / `idx_shares_created_at` も将来のクエリパターンで復活する可能性。削除メリット小。本 plan の Migration では一切 DROP しない。公開後 1 ヶ月程度運用後、**production の index 使用統計**を見て再評価する (staging 統計は参考程度)。

### Q5. 適用タイミング
**判断確定 (Resolved Decisions [適用タイミング] 参照): PR1/2 即時 + PR3 慎重**。PR1 (FK index + `discord_oauth_states` COMMENT) は staging 適用・確認後すぐ本番反映してよい。PR2 (RLS initplan の `(SELECT auth.uid())` ラップ) も挙動互換のため staging で主要画面動作確認後すぐ本番反映してよい。PR3 (multiple permissive policies 整理 + is_team_member hardening) は破壊リスクがあるため staging で 1 週間以上焼き込み、その間に Discord 連携 / チーム表示 / チーム統計 / メンバー一覧 / admin 画面 / 通常ユーザーの対戦入力・編集・削除を確認する。各 PR の本番 DB 適用は CLAUDE.md ルール通り main 反映後に行う。

### Q6. `discord_oauth_states` の意図を DB コメントに記録 (Advisor INFO 抑止が目的ではない)
**判断確定 (Resolved Decisions [lint silence] 参照): SQL COMMENT 追加**。`discord_oauth_states` は RLS enabled no policy が意図通り (クライアント / anon / authenticated には触らせない、service_role のみが Discord OAuth state nonce を短時間保存・消費する)。Migration 1 (PR1) の末尾もしくは独立した migration (例: `20260511000001b_discord_oauth_states_comment.sql`) として、`COMMENT ON TABLE public.discord_oauth_states IS 'RLS enabled with no policy intentionally: service_role 経由のみアクセスする Discord OAuth state nonce テーブル。anon/authenticated は REVOKE ALL で二重拒否。';` を追加する。**目的は警告抑止ではなく、設計意図を DB カタログに永続化すること**。`COMMENT ON TABLE` は Advisor の lint scan を直接消す機能ではないため `rls_enabled_no_policy` INFO は再走査でも残る可能性を許容する。Dashboard Lint Exception は使わない (git 履歴に意図を残すため)。

### Q7. ユーザー作業として残るもの（明示確認）
- ~~`auth_leaked_password_protection` の Dashboard 有効化~~ → **今回は保留** (Resolved Decisions [auth_leaked_password] 参照)
- ~~Advisor Lint Exception 登録~~ → **不要**。SQL COMMENT で代替 (Resolved Decisions [lint silence] 参照、Dashboard Lint Exception は必須作業にしない)
- staging Supabase project への db push（CLAUDE.md ルール: DB password URL はチャットに貼らない、ユーザーが手元で実行）
- production Supabase への db push（**main 反映後、ユーザーの明示「本番反映」指示後**）
- Supabase Dashboard → Database → Linter → Re-run Lints で警告 0 件確認 (ただし `rls_enabled_no_policy on discord_oauth_states` と `authenticated_security_definer_function_executable on is_my_team_member` は意図通り残存許容)

## 参考: ファイル参照
- 既存 hardening migrations: `supabase/migrations/20260424000001_security_hardening_additive.sql` / `20260424000002_security_hardening_restrictive.sql` / `20260426005408_secdef_search_path.sql` / `20260426050849_secdef_search_path_phase2.sql` / `20260509000001_secure_rpc_permissions.sql` / `20260509000004_secdef_hardening_phase_a.sql`
- 環境変数取得: `src/lib/cf-env.ts` の `getServerEnv`
- API ルート（service_role 経由 RPC 呼び出し例）: `src/app/api/internal/detection-scan/route.ts` / `src/app/api/discord/callback/route.ts`
- Supabase 型定義: `src/lib/supabase/database.types.ts`
- CLAUDE.md / AGENTS.md 抜粋: migration 適用順序（main 反映後）、URL ハードコード禁止、Secret は `getServerEnv()` 経由

## Resolved Decisions

- [is_admin REVOKE] is_admin_user() の authenticated への GRANT EXECUTE を REVOKE するか? → 現状維持
  - 理由: RLS policy 内で admin 判定に使っている関数なので、authenticated から EXECUTE を外すと admin 系 RLS が壊れる可能性がある
  - 関数は auth.uid() の自分自身について is_admin を返すだけで、他ユーザー情報を漏らさない
  - PUBLIC / anon への開放は避けるべきだが、authenticated への GRANT は意図的な例外として扱う
  - 今回の migration 対象には含めず、Advisor 上は「意図的に許容する SECURITY DEFINER helper」として分類する
- [team_member] is_team_member(p_team_id, p_user_id) の authenticated GRANT を維持するか、自己限定 wrapper `is_my_team_member(p_team_id)` を新設して REVOKE するか? → wrapper 新設 + REVOKE
  - 方針: `public.is_my_team_member(p_team_id uuid)` を新設し、関数内では `auth.uid()` を使って現在ログイン中ユーザーだけを判定する
  - クライアント / RPC から必要なら `is_my_team_member(team_id)` を使う
  - 既存の `is_team_member(p_team_id uuid, p_user_id uuid)` は任意 user_id を判定できるため、authenticated からの直接 EXECUTE を外す
  - ただし既存の RLS policy や SECURITY DEFINER 内部で `is_team_member` を使っている箇所があれば壊さないように検証する
  - staging で、Discord 連携済みユーザーのチーム表示・チーム統計・メンバー一覧が動くことを検証項目に入れる
- [PR 分割] 本 hardening を 1 PR にまとめるか、3 PR に分けるか? → 2-3 PR 分割
  - PR 1: unindexed foreign keys の index 追加（unused index は原則 DROP しない、低リスク性能改善のみ）
  - PR 2: auth_rls_initplan 対応（RLS policy 内の `auth.uid()` / `auth.role()` を `(SELECT auth.uid())` / `(SELECT auth.role())` に変更、既存挙動は変えない）
  - PR 3: multiple permissive policies の整理 + is_team_member hardening + SECURITY DEFINER RPC の分類・必要なら権限調整（破壊リスクがあるため staging で重点検証）
  - 各 PR ごとに migration を分け、staging DB へ適用して検証し、Advisor 差分を確認、問題なければ次へ進む
  - unused index は利用期間が短い可能性もあるので今回は DROP しない方針
- [unused index] unused_index 警告を公開前に削除するか? (production 2 件 / staging 4 件 差分あり) → 公開後に再評価
  - production CSV: 2 件 (`idx_feedback_status_created_at`, `alerts_game_idx`)
  - staging CSV: 4 件 (上記 + `idx_battles_tuning_id`, `idx_shares_created_at`)
  - 本番 / staging で差分があるのは staging が低トラフィックで使用統計の信頼性がさらに低いため。staging 追加 2 件も「未使用」とは断定できない
  - `idx_feedback_status_created_at` は管理画面や将来のフィードバック確認で使う可能性
  - `alerts_game_idx` は検知アラート / ゲーム別管理で使う可能性
  - `idx_battles_tuning_id` / `idx_shares_created_at` も将来のクエリパターンで使う可能性
  - 削除メリット小、全件保留
  - Plan には「unused index は本番/staging で差分があり、公開後 1 ヶ月程度の production 利用統計で再評価」と記載する
- [lint silence] discord_oauth_states の意図を DB に記録するか (`COMMENT ON TABLE` は Advisor lint scan を直接消す機能ではないため INFO は残る可能性を許容) → SQL COMMENT 追加
- [適用タイミング] 3 PR (FK index / RLS init plan / multiple permissive + is_team_member) の staging 焼き込み期間と本番反映タイミングをどう取りますか? → PR1/2 即時 + PR3 慎重
  - PR1 FK index + discord_oauth_states COMMENT + .gitignore は、staging 適用・確認後すぐ本番反映してよい
  - PR2 RLS initplan 対応も、挙動互換なので staging で主要画面確認後すぐ本番反映してよい
  - PR3 multiple permissive policies 整理 + is_team_member hardening は破壊リスクがあるため、staging で 1 週間以上焼き込み
  - PR3 の焼き込み中に、Discord 連携、チーム表示、チーム統計、メンバー一覧、admin 画面、通常ユーザーの対戦入力/編集/削除を確認する
  - 本番 DB への migration 適用は各 PR の main 反映後に行う
- [auth_leaked_password] auth_leaked_password_protection を公開前に Dashboard で ON するか? → 今回は保留
  - email/password 認証コードは `src/app/auth/page.tsx` に実装されているが、Email provider (SMTP / template 等) の本格運用は別判断
  - 今回の DB hardening では対応しない (Dashboard 設定タスクからも除外、公開前のユーザー作業として要求しない)
  - 将来 Email provider / Email ログインを本格運用する段階で「Enable leaked password protection」を ON にするかを再検討する
  - `discord_oauth_states` は RLS enabled no policy が意図通り（クライアント / anon / authenticated には触らせない、service_role のみが Discord OAuth state nonce を短時間保存・消費する）
  - Advisor INFO を無理に消す必要はない
  - migration で `COMMENT ON TABLE public.discord_oauth_states IS ...` を追加して、なぜ policy がないのかを明記する
  - 必要なら `COMMENT ON COLUMN` も最低限追加してよい
  - Dashboard 上の Lint Exception にはしない。git 履歴に意図を残す
