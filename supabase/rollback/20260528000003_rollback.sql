-- Plan D / D-3 ロールバック: SECDEF 関数を Plan D 適用前の定義に戻す
--
-- 出典:
--   - update_my_display_name(text): 20260424000001_security_hardening_additive.sql:19-25
--   - sync_my_x_connection(): 20260424000001:30-55
--   - clear_my_x_connection(): 20260424000001:58-64
--   - sync_team_membership(uuid, text, jsonb, text): 20260426005408_secdef_search_path.sql:269-314
--   - recalculate_opponent_decks(text, text): 20260426005408:225-242
--   - auto_add_opponent_deck: D-3 では touch しないため rollback 不要
--     (最新定義 20260520000001_opponent_deck_update_method_changes.sql のまま温存)
--   - run_daily_opponent_deck_batch(): D-3 では touch しないため rollback 不要

-- =============================================================================
-- グループ A
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_my_display_name(p_display_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.profiles SET display_name = p_display_name WHERE id = auth.uid();
END; $$;
REVOKE ALL ON FUNCTION public.update_my_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_display_name(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_my_x_connection()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_x_user_id text;
  v_x_username text;
BEGIN
  SELECT
    COALESCE(to_jsonb(i)->>'provider_id', i.identity_data->>'provider_id', i.id::text),
    COALESCE(i.identity_data->>'user_name', i.identity_data->>'preferred_username')
  INTO v_x_user_id, v_x_username
  FROM auth.identities i
  WHERE i.user_id = auth.uid() AND i.provider = 'twitter'
  ORDER BY i.last_sign_in_at DESC NULLS LAST
  LIMIT 1;

  IF v_x_username IS NULL OR v_x_user_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
  SET x_user_id = v_x_user_id, x_username = v_x_username
  WHERE id = auth.uid();
  RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.sync_my_x_connection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_x_connection() TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_my_x_connection()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.profiles SET x_user_id = NULL, x_username = NULL WHERE id = auth.uid();
END; $$;
REVOKE ALL ON FUNCTION public.clear_my_x_connection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_my_x_connection() TO authenticated;


-- =============================================================================
-- グループ B
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_team_membership(
  p_user_id uuid,
  p_discord_username text,
  p_guilds jsonb,
  p_game_title text DEFAULT 'dm'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  g jsonb;
  v_team_id uuid;
BEGIN
  FOR g IN SELECT * FROM jsonb_array_elements(p_guilds) LOOP
    INSERT INTO public.teams (discord_guild_id, name, icon_url, game_title)
    VALUES (g->>'id', g->>'name', g->>'icon', p_game_title)
    ON CONFLICT (discord_guild_id, game_title) DO UPDATE SET
      name = EXCLUDED.name,
      icon_url = EXCLUDED.icon_url,
      updated_at = now()
    RETURNING id INTO v_team_id;

    INSERT INTO public.team_members (team_id, user_id, discord_username)
    VALUES (v_team_id, p_user_id, p_discord_username)
    ON CONFLICT (team_id, user_id) DO UPDATE SET
      discord_username = EXCLUDED.discord_username;
  END LOOP;

  DELETE FROM public.team_members
  WHERE user_id = p_user_id
    AND team_id IN (
      SELECT t.id FROM public.teams t
      WHERE t.game_title = p_game_title
    )
    AND team_id NOT IN (
      SELECT t.id FROM public.teams t
      WHERE t.game_title = p_game_title
        AND t.discord_guild_id IN (SELECT g2->>'id' FROM jsonb_array_elements(p_guilds) g2)
    );
END;
$func$;
REVOKE ALL ON FUNCTION public.sync_team_membership(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_team_membership(uuid, text, jsonb, text) TO service_role;


-- =============================================================================
-- グループ C-2
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recalculate_opponent_decks(
  p_format text,
  p_game_title text DEFAULT 'dm'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
BEGIN
  IF NOT public.is_admin_user() THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  PERFORM public._recalculate_opponent_decks_internal(p_format, p_game_title);
END;
$func$;
REVOKE ALL ON FUNCTION public.recalculate_opponent_decks(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_opponent_decks(text, text) TO authenticated;


-- auto_add_opponent_deck は D-3 で touch しなかったため、本 rollback でも touch しない
-- (最新定義 20260520000001_opponent_deck_update_method_changes.sql の挙動 = 不正名 silent return /
--  admin mode 新規 INSERT is_active=true / REVOKE ALL = を保持)
