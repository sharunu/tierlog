-- PR2: Supabase Advisor `auth_rls_initplan` 警告 34 件への対応
--
-- 背景:
--   RLS policy 内で `auth.uid()` を直接呼ぶと、各行ごとに関数評価が走り (initplan ではなく re-eval)、
--   テーブル規模に応じてクエリが遅くなる。`(SELECT auth.uid())` でラップすると initplan として
--   1 回だけ評価されるため、スケール時の性能改善になる。
--   https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- 対象:
--   production / staging 両 DB で 34 件すべて一致 (Advisor CSV `(2).csv`)。
--   18 テーブルの policy を DROP POLICY IF EXISTS → CREATE POLICY のペアで書き換える。
--   `auth.uid()` を `(SELECT auth.uid())` に置換するだけで、USING/WITH CHECK の他のロジックは完全に維持する。
--
-- 設計原則:
--   - **挙動互換**: ロジックは一切変更しない。`auth.uid()` のラップのみ。
--   - **既存の深層防御 (EXISTS) は完全保持**:
--     - battles INSERT/UPDATE: decks 所有 + format/game_title 一致 + opponent_deck_settings EXISTS + tuning_id EXISTS
--     - decks INSERT/UPDATE: opponent_deck_settings EXISTS
--     - deck_tunings FOR ALL: decks 所有 EXISTS
--   - **TO 句保持**: feedback / opponent_deck_settings の `TO authenticated` 指定を維持。
--   - **同一 policy 名で DROP+CREATE**: idempotent、再適用しても結果一致。
--   - **同一 migration トランザクション内で実行**: DROP→CREATE 間のアクセス断は発生しない。
--
-- 非対象 (PR3 で対応):
--   - admin_select_* (battles/decks/deck_tunings/feedback/profiles) は `is_admin_user()` ベース → multiple_permissive_policies で処理
--   - user_read_premium_ui_setting on quality_scoring_settings は `key = 'premium_ui_visible'` のみで auth.uid() 不使用、Advisor 対象外


-- =============================================================================
-- 1. battles (4 policies、深層防御 WITH CHECK 完全保持)
-- =============================================================================

-- 1-1. SELECT
DROP POLICY IF EXISTS "Users can read own battles" ON public.battles;
CREATE POLICY "Users can read own battles"
  ON public.battles FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- 1-2. DELETE
DROP POLICY IF EXISTS "Users can delete own battles" ON public.battles;
CREATE POLICY "Users can delete own battles"
  ON public.battles FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- 1-3. INSERT (現行: 20260426050848_strengthen_decks_and_battles_rls.sql のロジック完全保持)
DROP POLICY IF EXISTS "Users can insert own battles" ON public.battles;
CREATE POLICY "Users can insert own battles"
  ON public.battles FOR INSERT
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

-- 1-4. UPDATE (現行: 20260426050848_strengthen_decks_and_battles_rls.sql のロジック完全保持)
DROP POLICY IF EXISTS "Users can update own battles" ON public.battles;
CREATE POLICY "Users can update own battles"
  ON public.battles FOR UPDATE
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


-- =============================================================================
-- 2. decks (4 policies、深層防御 WITH CHECK 完全保持)
-- =============================================================================

-- 2-1. SELECT
DROP POLICY IF EXISTS "Users can read own decks" ON public.decks;
CREATE POLICY "Users can read own decks"
  ON public.decks FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

-- 2-2. DELETE
DROP POLICY IF EXISTS "Users can delete own decks" ON public.decks;
CREATE POLICY "Users can delete own decks"
  ON public.decks FOR DELETE
  USING ((SELECT auth.uid()) = user_id);

-- 2-3. INSERT (現行: 20260426050848_strengthen_decks_and_battles_rls.sql のロジック完全保持)
DROP POLICY IF EXISTS "Users can insert own decks" ON public.decks;
CREATE POLICY "Users can insert own decks"
  ON public.decks FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.opponent_deck_settings s
      WHERE s.format = decks.format
        AND s.game_title = decks.game_title
    )
  );

-- 2-4. UPDATE (現行: 20260426050848_strengthen_decks_and_battles_rls.sql のロジック完全保持)
DROP POLICY IF EXISTS "Users can update own decks" ON public.decks;
CREATE POLICY "Users can update own decks"
  ON public.decks FOR UPDATE
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.opponent_deck_settings s
      WHERE s.format = decks.format
        AND s.game_title = decks.game_title
    )
  );


-- =============================================================================
-- 3. profiles (1 policy、SELECT のみ — UPDATE policy は 20260424000002 で削除済)
-- =============================================================================

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING ((SELECT auth.uid()) = id);


-- =============================================================================
-- 4. deck_tunings (1 policy、FOR ALL with EXISTS deck 所有検査保持)
-- =============================================================================

DROP POLICY IF EXISTS "Users can manage own deck tunings" ON public.deck_tunings;
CREATE POLICY "Users can manage own deck tunings"
  ON public.deck_tunings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.decks
      WHERE decks.id = deck_tunings.deck_id
        AND decks.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.decks
      WHERE decks.id = deck_tunings.deck_id
        AND decks.user_id = (SELECT auth.uid())
    )
  );


-- =============================================================================
-- 5. discord_connections (4 policies)
-- =============================================================================

DROP POLICY IF EXISTS "Users can read own discord connection" ON public.discord_connections;
CREATE POLICY "Users can read own discord connection"
  ON public.discord_connections FOR SELECT
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own discord connection" ON public.discord_connections;
CREATE POLICY "Users can insert own discord connection"
  ON public.discord_connections FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own discord connection" ON public.discord_connections;
CREATE POLICY "Users can update own discord connection"
  ON public.discord_connections FOR UPDATE
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own discord connection" ON public.discord_connections;
CREATE POLICY "Users can delete own discord connection"
  ON public.discord_connections FOR DELETE
  USING ((SELECT auth.uid()) = user_id);


-- =============================================================================
-- 6. team_members (3 policies — Team members read / 自己 update / 自己 delete)
--    "Team members can read team members" は is_team_member() ガード版を維持。
--    PR3 では is_my_team_member(team_id) に切り替える計画だが、PR2 は auth.uid() ラップのみ。
-- =============================================================================

DROP POLICY IF EXISTS "Team members can read team members" ON public.team_members;
CREATE POLICY "Team members can read team members"
  ON public.team_members FOR SELECT
  USING (public.is_team_member(team_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can update own membership" ON public.team_members;
CREATE POLICY "Users can update own membership"
  ON public.team_members FOR UPDATE
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can delete own membership" ON public.team_members;
CREATE POLICY "Users can delete own membership"
  ON public.team_members FOR DELETE
  USING (user_id = (SELECT auth.uid()));


-- =============================================================================
-- 7. teams (1 policy — Team members read)
--    "Team members can read team" は is_team_member() ガード版。PR3 で is_my_team_member 切替予定。
-- =============================================================================

DROP POLICY IF EXISTS "Team members can read team" ON public.teams;
CREATE POLICY "Team members can read team"
  ON public.teams FOR SELECT
  USING (public.is_team_member(id, (SELECT auth.uid())));


-- =============================================================================
-- 8. feedback (2 policies、`TO authenticated` 指定保持)
-- =============================================================================

DROP POLICY IF EXISTS "Users can insert own feedback" ON public.feedback;
CREATE POLICY "Users can insert own feedback"
  ON public.feedback FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read own feedback" ON public.feedback;
CREATE POLICY "Users can read own feedback"
  ON public.feedback FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);


-- =============================================================================
-- 9. shares (1 policy — INSERT のみ、SELECT は 20260509000002 で削除済)
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can create own shares" ON public.shares;
CREATE POLICY "Authenticated users can create own shares"
  ON public.shares FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);


-- =============================================================================
-- 10. opponent_deck_master (4 policies)
--     - "Authenticated users can read decks": auth.uid() IS NOT NULL
--     - "Admins can insert/update/delete": admin 判定 (EXISTS profiles ... is_admin)
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can read decks" ON public.opponent_deck_master;
CREATE POLICY "Authenticated users can read decks"
  ON public.opponent_deck_master FOR SELECT
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Admins can insert" ON public.opponent_deck_master;
CREATE POLICY "Admins can insert"
  ON public.opponent_deck_master FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins can update" ON public.opponent_deck_master;
CREATE POLICY "Admins can update"
  ON public.opponent_deck_master FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );

DROP POLICY IF EXISTS "Admins can delete" ON public.opponent_deck_master;
CREATE POLICY "Admins can delete"
  ON public.opponent_deck_master FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );


-- =============================================================================
-- 11. opponent_deck_settings (1 policy — Admin UPDATE、TO authenticated 保持)
--     SELECT policy ("Authenticated users can read settings") は USING (true) で auth.uid() 不使用のため対象外。
-- =============================================================================

DROP POLICY IF EXISTS "Admins can update settings" ON public.opponent_deck_settings;
CREATE POLICY "Admins can update settings"
  ON public.opponent_deck_settings FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );


-- =============================================================================
-- 12. user_stage_history (1 admin policy)
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_stage_history ON public.user_stage_history;
CREATE POLICY admin_manage_stage_history
  ON public.user_stage_history FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );


-- =============================================================================
-- 13. detection_rules (1 admin policy)
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_detection_rules ON public.detection_rules;
CREATE POLICY admin_manage_detection_rules
  ON public.detection_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );


-- =============================================================================
-- 14. detection_alerts (1 admin policy)
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_detection_alerts ON public.detection_alerts;
CREATE POLICY admin_manage_detection_alerts
  ON public.detection_alerts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );


-- =============================================================================
-- 15. quality_scoring_rules (1 admin policy)
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_quality_rules ON public.quality_scoring_rules;
CREATE POLICY admin_manage_quality_rules
  ON public.quality_scoring_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );


-- =============================================================================
-- 16. quality_score_snapshots (2 policies — admin FOR ALL + user 自己 SELECT)
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_quality_snapshots ON public.quality_score_snapshots;
CREATE POLICY admin_manage_quality_snapshots
  ON public.quality_score_snapshots FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );

DROP POLICY IF EXISTS user_read_own_quality_snapshot ON public.quality_score_snapshots;
CREATE POLICY user_read_own_quality_snapshot
  ON public.quality_score_snapshots FOR SELECT
  USING ((SELECT auth.uid()) = user_id);


-- =============================================================================
-- 17. quality_admin_bonus (1 admin policy)
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_quality_bonus ON public.quality_admin_bonus;
CREATE POLICY admin_manage_quality_bonus
  ON public.quality_admin_bonus FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );


-- =============================================================================
-- 18. quality_scoring_settings (1 admin policy — user_read_premium_ui_setting は対象外)
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_quality_settings ON public.quality_scoring_settings;
CREATE POLICY admin_manage_quality_settings
  ON public.quality_scoring_settings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = (SELECT auth.uid()) AND is_admin = true
    )
  );


-- =============================================================================
-- ロールバック用 SQL (必要時に手動で流す):
--   各 policy を `auth.uid()` の直接呼び出し版に戻す。
--   出典 migration:
--     - battles SELECT/DELETE: 20260426005407_strengthen_battles_rls.sql
--     - battles INSERT/UPDATE: 20260426050848_strengthen_decks_and_battles_rls.sql
--     - decks SELECT/DELETE/INSERT/UPDATE: 20260426050848
--     - profiles: 20260304000001_initial_schema.sql
--     - deck_tunings: 20260314000001_add_deck_tunings.sql
--     - discord_connections / teams / team_members read: 20260406000001 + 20260406000002 + 20260406000004
--     - feedback: 20260407000001_feedback.sql
--     - shares: 20260415000002_shares_table.sql
--     - opponent_deck_master: 20260305000001_admin_opponent_decks.sql
--     - opponent_deck_settings: 20260411000002_dual_mode_management.sql
--     - user_stage_history / detection_*: 20260412000007_user_stages.sql
--     - quality_*: 20260414000001_quality_scoring.sql
-- =============================================================================
