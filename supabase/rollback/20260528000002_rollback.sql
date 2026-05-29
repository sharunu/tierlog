-- Plan D / D-2 ロールバック: 書き込み系 RLS の access gate を除去
--
-- 旧 POLICY 定義 (Plan D 適用前の状態) に戻す。
-- 出典:
--   - battles INSERT/UPDATE: 20260511000003_rls_auth_init_plan.sql:46-100
--   - decks INSERT/UPDATE  : 20260511000003_rls_auth_init_plan.sql:119-144
--   - deck_tunings INSERT/UPDATE: 20260511000004_consolidate_admin_select_policies.sql:108-132
--   - shares INSERT: 20260511000003_rls_auth_init_plan.sql:257-260
--
-- 注意: 本 SQL は D-1 関数 (account_access_state) がまだ存在する状態で流すことを前提とする。
-- D-1 関数を先に DROP すると本 SQL の DROP POLICY が CASCADE で動いて意図せず追加削除する
-- 可能性があるため、ロールバック順序は D-3 → D-2 → D-1 とする。

-- =============================================================================
-- 1. battles INSERT/UPDATE を access gate 無し版に戻す
-- =============================================================================

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
-- 2. decks INSERT/UPDATE を access gate 無し版に戻す
-- =============================================================================

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
-- 3. deck_tunings INSERT/UPDATE を access gate 無し版に戻す
-- =============================================================================

DROP POLICY IF EXISTS "Users can insert own deck tunings" ON public.deck_tunings;
CREATE POLICY "Users can insert own deck tunings" ON public.deck_tunings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.decks
      WHERE decks.id = deck_tunings.deck_id
        AND decks.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update own deck tunings" ON public.deck_tunings;
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


-- =============================================================================
-- 4. shares INSERT を access gate 無し版に戻す
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can create own shares" ON public.shares;
CREATE POLICY "Authenticated users can create own shares"
  ON public.shares FOR INSERT
  WITH CHECK ((SELECT auth.uid()) = user_id);
