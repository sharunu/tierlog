-- Plan D / D-2: 書き込み系 RLS access gate (battles / decks / deck_tunings / shares)
--
-- 背景:
--   現状の書き込み系 RLS POLICY は WITH CHECK で auth.uid() = user_id + 深層防御
--   (decks 所有 / format-game 一致 / opponent_deck_settings EXISTS / tuning_id EXISTS)
--   までは入っているが、profiles.stage の検査が無い。stage=4 (BAN) ユーザーが
--   REST 直叩きで書き込みできる経路が残っていた。
--
-- 設計:
--   - RD-D2: 対象は battles / decks / deck_tunings / shares のみ。feedback / team_members は対象外。
--     - feedback: BAN 不服申立て経路として残す (誤 BAN 復旧導線)
--     - team_members: 直接書き込み経路が薄いため対象外
--   - SELECT / DELETE POLICY は変更しない: BAN ユーザーが自分のデータを閲覧 / 削除する権利は維持。
--   - INSERT / UPDATE POLICY のみ末尾に `AND public.account_access_state((SELECT auth.uid())) = 'active'` を AND。
--   - 既存 depth-defense (EXISTS decks 所有 / format-game 一致 / opponent_deck_settings EXISTS / tuning_id EXISTS)
--     は完全保持。Plan D は access gate を末尾に append するだけ。
--   - deck_tunings は 20260511000004 で SELECT/INSERT/UPDATE/DELETE の 4 本に分割済。
--     本 plan は INSERT / UPDATE のみ書き換え。
--   - (SELECT auth.uid()) ラップ: 既存 20260511000003 の initplan 最適化規約を維持。
--   - shares INSERT は Plan A の is_safe_share_image_url trigger と独立 (trigger は touch しない)。
--
-- DROP+CREATE で挙動互換に書き換え (同一 transaction 内、アクセス断なし)。
-- 旧 POLICY 名と完全一致させて idempotent。

-- =============================================================================
-- 1. battles INSERT/UPDATE
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
    AND public.account_access_state((SELECT auth.uid())) = 'active'
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
    AND public.account_access_state((SELECT auth.uid())) = 'active'
  );


-- =============================================================================
-- 2. decks INSERT/UPDATE
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
    AND public.account_access_state((SELECT auth.uid())) = 'active'
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
    AND public.account_access_state((SELECT auth.uid())) = 'active'
  );


-- =============================================================================
-- 3. deck_tunings INSERT/UPDATE (20260511000004 で 4 本分割済)
--    SELECT / DELETE は変更しない (RD-D2 + 本 plan D-2 の SELECT/DELETE 非変更方針)
-- =============================================================================

DROP POLICY IF EXISTS "Users can insert own deck tunings" ON public.deck_tunings;
CREATE POLICY "Users can insert own deck tunings" ON public.deck_tunings
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.decks
      WHERE decks.id = deck_tunings.deck_id
        AND decks.user_id = (SELECT auth.uid())
    )
    AND public.account_access_state((SELECT auth.uid())) = 'active'
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
    AND public.account_access_state((SELECT auth.uid())) = 'active'
  );


-- =============================================================================
-- 4. shares INSERT (SELECT は 20260509000002 で削除済、DELETE は別 POLICY)
--    is_safe_share_image_url trigger (Plan A) は touch しない
-- =============================================================================

DROP POLICY IF EXISTS "Authenticated users can create own shares" ON public.shares;
CREATE POLICY "Authenticated users can create own shares"
  ON public.shares FOR INSERT
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND public.account_access_state((SELECT auth.uid())) = 'active'
  );
