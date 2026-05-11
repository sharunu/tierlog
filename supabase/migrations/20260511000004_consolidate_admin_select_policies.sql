-- PR3 (1/2): Supabase Advisor `multiple_permissive_policies` への対応
--
-- 背景:
--   7 テーブル (battles / decks / deck_tunings / profiles / feedback / quality_score_snapshots /
--   quality_scoring_settings) で admin 系 PERMISSIVE policy と user 自己 policy が同 (role, action)
--   ペアで重複し、SELECT クエリごとに両方評価されている (Advisor 集計値: production 37 件 /
--   staging 31 件、対象テーブルは両 DB 同一)。
--
-- 設計方針:
--   - admin SELECT policy を user 自己 SELECT policy に統合し、`OR (SELECT public.is_admin_user())` を
--     追加して permissive 重複を解消する。RESTRICTIVE には変換しない (AND 評価になり全閉鎖)。
--   - admin_select_* (FOR SELECT) は DROP し user policy を OR 拡張で再作成 (battles/decks/profiles/feedback)
--   - admin_manage_* (FOR ALL) は DROP し、SELECT を user 側に OR 統合 + admin INSERT/UPDATE/DELETE を別途
--     CREATE し直すことで admin の write 経路を保持 (quality_score_snapshots / quality_scoring_settings)。
--   - deck_tunings は user 側 "Users can manage own deck tunings" が FOR ALL + EXISTS deck 所有 のため、
--     素朴な OR 統合だと admin が他人の deck_tunings を UPDATE/DELETE できる privilege escalation。
--     → SELECT consolidated + INSERT/UPDATE/DELETE は所有者ベース 3 本に分割。
--   - `is_admin_user()` も `(SELECT public.is_admin_user())` でラップ (initplan 最適化 + PR2 と整合)
--   - `(SELECT auth.uid())` ラップは PR2 で適用済の wrapping を維持
--
-- 既存深層防御の保持:
--   - battles / decks の SELECT は user_id チェックのみ (INSERT/UPDATE の EXISTS WITH CHECK は本 migration 対象外)
--   - feedback の `TO authenticated` 句を保持
--   - quality_scoring_settings の `key = 'premium_ui_visible'` フィルタを保持
--
-- 適用後の RLS 配置 (本 migration 適用後):
--   - battles SELECT: user 自己 OR admin (1 本)
--   - decks SELECT: user 自己 OR admin (1 本)
--   - profiles SELECT: user 自己 OR admin (1 本)
--   - feedback SELECT: user 自己 OR admin (1 本)
--   - deck_tunings: SELECT (consolidated) + INSERT/UPDATE/DELETE (所有者) の計 4 本
--   - quality_score_snapshots: SELECT (consolidated) + INSERT/UPDATE/DELETE admin の計 4 本
--   - quality_scoring_settings: SELECT (consolidated, key フィルタ保持) + INSERT/UPDATE/DELETE admin の計 4 本


-- =============================================================================
-- 1. battles - admin_select_battles を user SELECT に統合
-- =============================================================================

DROP POLICY IF EXISTS admin_select_battles ON public.battles;
DROP POLICY IF EXISTS "Users can read own battles" ON public.battles;
CREATE POLICY "Users can read own battles" ON public.battles
  FOR SELECT USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_admin_user())
  );


-- =============================================================================
-- 2. decks - admin_select_decks を user SELECT に統合
-- =============================================================================

DROP POLICY IF EXISTS admin_select_decks ON public.decks;
DROP POLICY IF EXISTS "Users can read own decks" ON public.decks;
CREATE POLICY "Users can read own decks" ON public.decks
  FOR SELECT USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_admin_user())
  );


-- =============================================================================
-- 3. profiles - admin_select_profiles を user SELECT に統合
-- =============================================================================

DROP POLICY IF EXISTS admin_select_profiles ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (
    (SELECT auth.uid()) = id
    OR (SELECT public.is_admin_user())
  );


-- =============================================================================
-- 4. feedback - admin_select_feedback を user SELECT に統合 (TO authenticated 保持)
-- =============================================================================

DROP POLICY IF EXISTS admin_select_feedback ON public.feedback;
DROP POLICY IF EXISTS "Users can read own feedback" ON public.feedback;
CREATE POLICY "Users can read own feedback" ON public.feedback
  FOR SELECT TO authenticated USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_admin_user())
  );


-- =============================================================================
-- 5. deck_tunings - admin_select_deck_tunings + FOR ALL を 4 policies に分割
--    user 側 "Users can manage own deck tunings" が FOR ALL + EXISTS deck 所有 のため、
--    素朴な OR 統合は admin が他人の deck_tunings を write できる privilege escalation。
--    SELECT のみ consolidated、INSERT/UPDATE/DELETE は所有者ベースで分離する。
-- =============================================================================

DROP POLICY IF EXISTS admin_select_deck_tunings ON public.deck_tunings;
DROP POLICY IF EXISTS "Users can manage own deck tunings" ON public.deck_tunings;

CREATE POLICY "Users can read own deck tunings" ON public.deck_tunings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.decks
      WHERE decks.id = deck_tunings.deck_id
        AND decks.user_id = (SELECT auth.uid())
    )
    OR (SELECT public.is_admin_user())
  );

CREATE POLICY "Users can insert own deck tunings" ON public.deck_tunings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.decks
      WHERE decks.id = deck_tunings.deck_id
        AND decks.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Users can update own deck tunings" ON public.deck_tunings
  FOR UPDATE
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

CREATE POLICY "Users can delete own deck tunings" ON public.deck_tunings
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.decks
      WHERE decks.id = deck_tunings.deck_id
        AND decks.user_id = (SELECT auth.uid())
    )
  );


-- =============================================================================
-- 6. quality_score_snapshots - FOR ALL を SELECT consolidated + admin write 3 本に分割
--    admin_manage_quality_snapshots (FOR ALL) を DROP したまま放置すると admin の write 経路が
--    消失するため、run_quality_scoring の snapshot upsert が SECDEF 経由でなくなった場合に備え
--    admin INSERT/UPDATE/DELETE policy を明示する。
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_quality_snapshots ON public.quality_score_snapshots;
DROP POLICY IF EXISTS user_read_own_quality_snapshot ON public.quality_score_snapshots;

CREATE POLICY user_read_own_quality_snapshot
  ON public.quality_score_snapshots FOR SELECT USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_admin_user())
  );

CREATE POLICY admin_insert_quality_snapshots
  ON public.quality_score_snapshots FOR INSERT
  WITH CHECK ((SELECT public.is_admin_user()));

CREATE POLICY admin_update_quality_snapshots
  ON public.quality_score_snapshots FOR UPDATE
  USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));

CREATE POLICY admin_delete_quality_snapshots
  ON public.quality_score_snapshots FOR DELETE
  USING ((SELECT public.is_admin_user()));


-- =============================================================================
-- 7. quality_scoring_settings - FOR ALL を SELECT consolidated + admin write 3 本に分割
--    user_read_premium_ui_setting の `key = 'premium_ui_visible'` 制限を SELECT 側で維持し、
--    admin は全 key を読めるよう OR で拡張。書き込みは admin のみに限定。
-- =============================================================================

DROP POLICY IF EXISTS admin_manage_quality_settings ON public.quality_scoring_settings;
DROP POLICY IF EXISTS user_read_premium_ui_setting ON public.quality_scoring_settings;

CREATE POLICY user_read_premium_ui_setting
  ON public.quality_scoring_settings FOR SELECT USING (
    key = 'premium_ui_visible'
    OR (SELECT public.is_admin_user())
  );

CREATE POLICY admin_insert_quality_settings
  ON public.quality_scoring_settings FOR INSERT
  WITH CHECK ((SELECT public.is_admin_user()));

CREATE POLICY admin_update_quality_settings
  ON public.quality_scoring_settings FOR UPDATE
  USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));

CREATE POLICY admin_delete_quality_settings
  ON public.quality_scoring_settings FOR DELETE
  USING ((SELECT public.is_admin_user()));


-- =============================================================================
-- ロールバック用 SQL (必要時に手動で流す):
--
--   -- 1. battles
--   DROP POLICY IF EXISTS "Users can read own battles" ON public.battles;
--   CREATE POLICY "Users can read own battles" ON public.battles
--     FOR SELECT USING ((SELECT auth.uid()) = user_id);
--   CREATE POLICY admin_select_battles ON public.battles
--     FOR SELECT USING (public.is_admin_user());
--
--   -- 2. decks
--   DROP POLICY IF EXISTS "Users can read own decks" ON public.decks;
--   CREATE POLICY "Users can read own decks" ON public.decks
--     FOR SELECT USING ((SELECT auth.uid()) = user_id);
--   CREATE POLICY admin_select_decks ON public.decks
--     FOR SELECT USING (public.is_admin_user());
--
--   -- 3. profiles
--   DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
--   CREATE POLICY "Users can view own profile" ON public.profiles
--     FOR SELECT USING ((SELECT auth.uid()) = id);
--   CREATE POLICY admin_select_profiles ON public.profiles
--     FOR SELECT USING (public.is_admin_user());
--
--   -- 4. feedback
--   DROP POLICY IF EXISTS "Users can read own feedback" ON public.feedback;
--   CREATE POLICY "Users can read own feedback" ON public.feedback
--     FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
--   CREATE POLICY admin_select_feedback ON public.feedback
--     FOR SELECT USING (public.is_admin_user());
--
--   -- 5. deck_tunings (4 本を FOR ALL に戻す)
--   DROP POLICY IF EXISTS "Users can read own deck tunings" ON public.deck_tunings;
--   DROP POLICY IF EXISTS "Users can insert own deck tunings" ON public.deck_tunings;
--   DROP POLICY IF EXISTS "Users can update own deck tunings" ON public.deck_tunings;
--   DROP POLICY IF EXISTS "Users can delete own deck tunings" ON public.deck_tunings;
--   CREATE POLICY "Users can manage own deck tunings" ON public.deck_tunings FOR ALL
--     USING (EXISTS (SELECT 1 FROM public.decks WHERE decks.id = deck_tunings.deck_id AND decks.user_id = (SELECT auth.uid())))
--     WITH CHECK (EXISTS (SELECT 1 FROM public.decks WHERE decks.id = deck_tunings.deck_id AND decks.user_id = (SELECT auth.uid())));
--   CREATE POLICY admin_select_deck_tunings ON public.deck_tunings
--     FOR SELECT USING (public.is_admin_user());
--
--   -- 6. quality_score_snapshots (FOR ALL admin に戻す)
--   DROP POLICY IF EXISTS user_read_own_quality_snapshot ON public.quality_score_snapshots;
--   DROP POLICY IF EXISTS admin_insert_quality_snapshots ON public.quality_score_snapshots;
--   DROP POLICY IF EXISTS admin_update_quality_snapshots ON public.quality_score_snapshots;
--   DROP POLICY IF EXISTS admin_delete_quality_snapshots ON public.quality_score_snapshots;
--   CREATE POLICY admin_manage_quality_snapshots ON public.quality_score_snapshots FOR ALL
--     USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_admin = true));
--   CREATE POLICY user_read_own_quality_snapshot ON public.quality_score_snapshots
--     FOR SELECT USING ((SELECT auth.uid()) = user_id);
--
--   -- 7. quality_scoring_settings (FOR ALL admin に戻す)
--   DROP POLICY IF EXISTS user_read_premium_ui_setting ON public.quality_scoring_settings;
--   DROP POLICY IF EXISTS admin_insert_quality_settings ON public.quality_scoring_settings;
--   DROP POLICY IF EXISTS admin_update_quality_settings ON public.quality_scoring_settings;
--   DROP POLICY IF EXISTS admin_delete_quality_settings ON public.quality_scoring_settings;
--   CREATE POLICY admin_manage_quality_settings ON public.quality_scoring_settings FOR ALL
--     USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_admin = true));
--   CREATE POLICY user_read_premium_ui_setting ON public.quality_scoring_settings
--     FOR SELECT USING (key = 'premium_ui_visible');
-- =============================================================================
