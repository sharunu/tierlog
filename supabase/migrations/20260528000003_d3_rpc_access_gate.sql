-- Plan D / D-3: 書き込み系 SECDEF 関数の access gate
--
-- 背景:
--   書き込み系 SECDEF 関数は RLS を bypass するため、D-2 で塞いだ stage=4 ユーザーの
--   経路が SECDEF 関数経由で残る。グループ別に gate 対象 (auth.uid() / p_user_id) を変える。
--
-- 設計 (subject 別グループ分け):
--   - グループ A: 本人 (authenticated user) が呼ぶ関数 → auth.uid() を gate 対象
--     対象: update_my_display_name(text) / sync_my_x_connection() / clear_my_x_connection()
--   - グループ B: service_role 専用関数 (authenticated に GRANT なし) → p_user_id を gate 対象
--     対象: sync_team_membership(uuid, text, jsonb, text)
--     (discord callback / refresh-guilds から service_role + 明示 p_user_id で呼ばれる)
--   - グループ C-1: cron / service_role 経由 → access gate を入れない
--     対象: run_daily_opponent_deck_batch()
--     (auth.uid() が NULL になり 'unauthenticated' で必ず弾かれ cron が停止するため絶対に入れない)
--   - グループ C-2: authenticated admin 経路 → 既存 admin check + access gate
--     対象: recalculate_opponent_decks(text, text)
--     (admin は account_access_state の admin 例外で 'active' が返るので素通る)
--   - その他:
--     - auto_add_opponent_deck: battles INSERT trigger から呼ばれるため、battles INSERT POLICY (D-2) で
--       既に防がれる → 明示 gate 不要だが、authenticated 直呼びも可能 (CLI 等) なので冗長に入れる
--       (admin 例外で素通り、stage=4 一般ユーザーで弾く)
--
-- 各関数のシグネチャ / 既存ロジックは出典 migration から完全保持 (CREATE OR REPLACE):
--   - update_my_display_name(text): 20260424000001_security_hardening_additive.sql:19-25
--   - sync_my_x_connection(): 20260424000001:30-55
--   - clear_my_x_connection(): 20260424000001:58-64
--   - sync_team_membership(uuid, text, jsonb, text): 20260426005408_secdef_search_path.sql:269-314
--   - recalculate_opponent_decks(text, text): 20260426005408:225-242
--   - auto_add_opponent_deck(text, text, text): 20260426005408:42-100
--
-- 失敗時 RAISE は既存規約に合わせて ERRCODE 指定:
--   - 'account_banned' (新規): 一般 PostgreSQL exception (SQLSTATE 'P0001' 既定)
--   - 既存の 'admin only' や 'auth required' はそのまま (出典規約準拠)

-- =============================================================================
-- グループ A: 本人 authenticated 関数 (auth.uid() を gate)
-- =============================================================================

-- A-1. update_my_display_name
CREATE OR REPLACE FUNCTION public.update_my_display_name(p_display_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE='42501';
  END IF;
  -- Plan D / D-3 グループ A: 本人 access state チェック
  IF public.account_access_state(v_uid) <> 'active' THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  UPDATE public.profiles SET display_name = p_display_name WHERE id = v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.update_my_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_display_name(text) TO authenticated;


-- A-2. sync_my_x_connection
CREATE OR REPLACE FUNCTION public.sync_my_x_connection()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_x_user_id text;
  v_x_username text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE='42501';
  END IF;
  -- Plan D / D-3 グループ A: 本人 access state チェック
  IF public.account_access_state(v_uid) <> 'active' THEN
    RAISE EXCEPTION 'account_banned';
  END IF;

  SELECT
    COALESCE(to_jsonb(i)->>'provider_id', i.identity_data->>'provider_id', i.id::text),
    COALESCE(i.identity_data->>'user_name', i.identity_data->>'preferred_username')
  INTO v_x_user_id, v_x_username
  FROM auth.identities i
  WHERE i.user_id = v_uid AND i.provider = 'twitter'
  ORDER BY i.last_sign_in_at DESC NULLS LAST
  LIMIT 1;

  IF v_x_username IS NULL OR v_x_user_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
  SET x_user_id = v_x_user_id, x_username = v_x_username
  WHERE id = v_uid;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_my_x_connection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_my_x_connection() TO authenticated;


-- A-3. clear_my_x_connection
CREATE OR REPLACE FUNCTION public.clear_my_x_connection()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE='42501';
  END IF;
  -- Plan D / D-3 グループ A: 本人 access state チェック
  IF public.account_access_state(v_uid) <> 'active' THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  UPDATE public.profiles SET x_user_id = NULL, x_username = NULL WHERE id = v_uid;
END;
$$;
REVOKE ALL ON FUNCTION public.clear_my_x_connection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_my_x_connection() TO authenticated;


-- =============================================================================
-- グループ B: service_role 専用関数 (p_user_id を gate)
-- =============================================================================

-- B-1. sync_team_membership: discord callback / refresh-guilds から service_role + 明示 p_user_id 経路
--      auth.uid() を使うと壊れる (service_role コンテキストで NULL)
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
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE='22023';
  END IF;
  -- Plan D / D-3 グループ B: p_user_id を gate 対象 (auth.uid() は service_role 経路で NULL)
  -- admin 例外 (RD-D3-1) は account_access_state 関数内で担保される
  IF public.account_access_state(p_user_id) <> 'active' THEN
    RAISE EXCEPTION 'account_banned';
  END IF;

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

  -- このユーザーの当該ゲームでの未所属チームを削除
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
-- グループ C-1: cron / service_role 経路 (gate を入れない)
-- =============================================================================
--
-- run_daily_opponent_deck_batch: pg_cron / Supabase scheduled job から service_role で呼ばれる
-- cron 専用関数。auth.uid() は NULL を返すため account_access_state を入れると 'unauthenticated'
-- で必ず弾かれて cron が止まる。Plan D ではこの関数を「変更しない」=既存定義のまま温存する。
-- (本 migration では touch せず、20260426005408_secdef_search_path.sql:247-263 の定義をそのまま使う)


-- =============================================================================
-- グループ C-2: authenticated admin 経路 (既存 admin check + access gate)
-- =============================================================================

-- C-2-1. recalculate_opponent_decks: admin UI / curl から authenticated 経路で呼ばれる
--        既存 admin check の直後に access state チェックを追加
--        admin は account_access_state の admin 例外 (RD-D3-1) で 'active' が返るので素通る
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
  -- Plan D / D-3 グループ C-2: 既存 admin check の直後に access gate を追加。
  -- 通常 admin = is_admin_user true なので account_access_state は admin 例外で 'active' が返り素通る。
  -- ここに到達して 'active' 以外が返るのは、profiles 行が消えた / NULL の特殊状態のみ。
  IF public.account_access_state(auth.uid()) <> 'active' THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  PERFORM public._recalculate_opponent_decks_internal(p_format, p_game_title);
END;
$func$;
REVOKE ALL ON FUNCTION public.recalculate_opponent_decks(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalculate_opponent_decks(text, text) TO authenticated;


-- =============================================================================
-- その他: auto_add_opponent_deck (battles trigger 経由が主、authenticated 直呼びも残す)
-- =============================================================================
--
-- battles INSERT trigger から呼ばれる経路は D-2 (battles INSERT POLICY の access gate) で
-- 既に防がれる。ただし、authenticated 直呼び (CLI / RPC test 等) も技術的に可能なため、
-- 関数内部にも冗長に access gate を入れる。admin 例外で素通り、stage=4 一般ユーザーで弾く。
CREATE OR REPLACE FUNCTION public.auto_add_opponent_deck(
  p_deck_name text,
  p_format text,
  p_game_title text DEFAULT 'dm'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text;
  v_max_sort integer;
BEGIN
  -- 入力検証: 認証済み・空文字 / 長すぎを拒否・format/game の組が登録済みであること
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE='42501';
  END IF;
  -- Plan D / D-3 補足: trigger 経路は D-2 で防ぐが、直呼び対策で冗長 gate
  IF public.account_access_state(v_uid) <> 'active' THEN
    RAISE EXCEPTION 'account_banned';
  END IF;
  IF p_deck_name IS NULL OR length(trim(p_deck_name)) = 0 OR length(p_deck_name) > 80 THEN
    RAISE EXCEPTION 'invalid deck name' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.opponent_deck_settings s
    WHERE s.format = p_format AND s.game_title = p_game_title
  ) THEN
    RAISE EXCEPTION 'unknown format/game combination' USING ERRCODE='22023';
  END IF;

  -- 管理モード取得
  SELECT management_mode INTO v_mode
  FROM public.opponent_deck_settings
  WHERE format = p_format AND game_title = p_game_title;

  -- 既存デッキ更新: auto モードなら is_active も true に
  UPDATE public.opponent_deck_master
  SET last_used_at = now(),
      is_active = CASE WHEN v_mode = 'auto' THEN true ELSE is_active END
  WHERE name = p_deck_name
    AND format = p_format
    AND game_title = p_game_title;

  IF FOUND THEN RETURN; END IF;

  -- 新規追加
  SELECT COALESCE(MAX(sort_order), 0) INTO v_max_sort
  FROM public.opponent_deck_master
  WHERE format = p_format AND game_title = p_game_title;

  IF v_mode = 'auto' THEN
    INSERT INTO public.opponent_deck_master (name, format, game_title, category, is_active, sort_order, last_used_at)
    VALUES (p_deck_name, p_format, p_game_title, 'other', true, v_max_sort + 10, now());
  ELSE
    INSERT INTO public.opponent_deck_master (name, format, game_title, category, is_active, sort_order, last_used_at)
    VALUES (p_deck_name, p_format, p_game_title, 'other', false, v_max_sort + 10, now());
  END IF;
END;
$func$;
REVOKE ALL ON FUNCTION public.auto_add_opponent_deck(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_add_opponent_deck(text, text, text) TO authenticated;
