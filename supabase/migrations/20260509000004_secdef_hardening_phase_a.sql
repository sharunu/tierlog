-- Phase A: SECDEF ハードニング + share-images SELECT policy 削除
--
-- 背景:
--   一般公開前 hardening の第 1 弾。codex / Claude Code 共同レビューで残存した P1 を、
--   依存更新・lint 修正・bundle 削減と独立した単一 migration で塞ぐ。
--
-- 対象 4 グループ:
--   1. admin SECDEF 3 関数: SET search_path = '' + 完全修飾 + REVOKE PUBLIC,anon,service_role + GRANT authenticated
--   2. Team RPC 8 本: REVOKE PUBLIC,anon,service_role + GRANT authenticated (本体は 20260424000001 で既ハードニング済)
--   3. Trigger 専用関数 2 本 + rls_auto_enable 条件付き: 直 EXECUTE 全閉鎖
--   4. share-images の広い public SELECT policy を削除 (公開URL配信は bucket public で成立、listing は塞ぐ)
--
-- 設計原則:
--   - CREATE OR REPLACE FUNCTION の直後に必ず REVOKE → GRANT を置く (Postgres の REPLACE 時の権限保持挙動に依存しない)
--   - Team / trigger は本体再作成せず権限のみ。署名は型のみで指定 (DEFAULT は書かない)
--   - get_users_for_admin() は 20260417000001 ベース (stage / auth_provider を含む 10 列戻り値)
--   - service_role も revoke: src/ grep で admin/Team RPC 呼び出しが全て @/lib/supabase/client (browser anon-key + authenticated session) 経由のため安全

-- =============================================================================
-- 1. admin SECDEF 3 関数 (本体再作成 + search_path + 完全修飾 + 権限締め)
-- =============================================================================

-- 1-1. get_users_for_admin (最新: 20260417000001_admin_list_enhancements.sql:6 — stage / auth_provider 追加版)
DROP FUNCTION IF EXISTS public.get_users_for_admin();
CREATE FUNCTION public.get_users_for_admin()
RETURNS TABLE (
  id uuid,
  display_name text,
  email text,
  is_guest boolean,
  created_at timestamptz,
  battle_count bigint,
  x_username text,
  x_user_id text,
  stage integer,
  auth_provider text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.display_name,
    u.email::text,
    p.is_guest,
    u.created_at,
    (SELECT COUNT(*) FROM public.battles b WHERE b.user_id = p.id) AS battle_count,
    p.x_username,
    p.x_user_id,
    p.stage,
    COALESCE(u.raw_app_meta_data->>'provider', 'unknown')::text AS auth_provider
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY u.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_users_for_admin() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_users_for_admin() TO authenticated;

-- 1-2. get_user_detail_for_admin (20260416000002_admin_user_enhancements.sql:42 ベース)
CREATE OR REPLACE FUNCTION public.get_user_detail_for_admin(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_profile record;
  v_discord record;
  v_teams jsonb;
  v_email text;
  v_provider text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT p.x_username, p.x_user_id INTO v_profile
  FROM public.profiles p WHERE p.id = p_user_id;

  SELECT dc.discord_id, dc.discord_username INTO v_discord
  FROM public.discord_connections dc WHERE dc.user_id = p_user_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'team_id', t.id,
      'team_name', t.name,
      'discord_guild_id', t.discord_guild_id,
      'icon_url', t.icon_url,
      'members', (
        SELECT COALESCE(jsonb_agg(
          jsonb_build_object('user_id', tm2.user_id, 'discord_username', tm2.discord_username)
        ), '[]'::jsonb)
        FROM public.team_members tm2
        WHERE tm2.team_id = t.id AND tm2.hidden_at IS NULL
      )
    )
  ), '[]'::jsonb)
  INTO v_teams
  FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id
  WHERE tm.user_id = p_user_id;

  SELECT u.email::text, COALESCE(u.raw_app_meta_data->>'provider', 'unknown')
  INTO v_email, v_provider
  FROM auth.users u WHERE u.id = p_user_id;

  RETURN jsonb_build_object(
    'x_username', v_profile.x_username,
    'x_user_id', v_profile.x_user_id,
    'discord_id', v_discord.discord_id,
    'discord_username', v_discord.discord_username,
    'teams', v_teams,
    'auth_provider', v_provider,
    'email', v_email
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_user_detail_for_admin(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_detail_for_admin(uuid) TO authenticated;

-- 1-3. update_feedback_status (20260417000001_admin_list_enhancements.sql:56 ベース)
CREATE OR REPLACE FUNCTION public.update_feedback_status(
  p_feedback_id uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_status NOT IN ('pending', 'resolved') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;
  UPDATE public.feedback SET status = p_status WHERE id = p_feedback_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_feedback_status(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_feedback_status(uuid, text) TO authenticated;


-- =============================================================================
-- 2. Team RPC 8 本: 権限のみ締める (本体は 20260424000001 で既に search_path = '' + is_team_member ガード済)
--    シグネチャは 20260424000001 で確定した型のみ。DEFAULT は書かない。
-- =============================================================================

REVOKE ALL ON FUNCTION public.get_team_my_deck_stats_range(uuid, uuid, date, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_my_deck_stats_range(uuid, uuid, date, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_opponent_deck_stats_range(uuid, uuid, date, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_opponent_deck_stats_range(uuid, uuid, date, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_deck_detail_stats(uuid, text, text, uuid, date, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_deck_detail_stats(uuid, text, text, uuid, date, date) TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_opponent_deck_detail_stats(uuid, text, text, uuid, date, date) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_opponent_deck_detail_stats(uuid, text, text, uuid, date, date) TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_turn_order_stats_range(uuid, uuid, date, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_turn_order_stats_range(uuid, uuid, date, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_member_summaries(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_member_summaries(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_deck_trend_range(uuid, uuid, date, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_deck_trend_range(uuid, uuid, date, date, text) TO authenticated;

REVOKE ALL ON FUNCTION public.get_team_members(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_team_members(uuid) TO authenticated;


-- =============================================================================
-- 3. Trigger 専用関数 2 本: 直 EXECUTE 全閉鎖
--    trigger 起動は所有者ロールで動くため EXECUTE 権限なしでも
--    BEFORE INSERT OR UPDATE / AFTER INSERT ON auth.users の発火は維持される。
-- =============================================================================

REVOKE ALL ON FUNCTION public.normalize_battle_deck_names() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;


-- =============================================================================
-- 3-bis. rls_auto_enable() の条件付き revoke
--    リポジトリの supabase/migrations/ 配下に定義なし。codex の DB カタログ確認で
--    SECDEF + 直 EXECUTE 残存が報告された。リポジトリ管理外で DB に存在する可能性が
--    あるため to_regprocedure で実行時チェックして条件付き REVOKE。存在しなければ no-op。
-- =============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role';
  END IF;
END $$;


-- =============================================================================
-- 4. share-images storage policy 削除
--    public bucket では公開URL配信 (object download) は SELECT policy なしで成立する
--    (Supabase 公式: "bypasses access controls for both retrieving and serving files")。
--    listing (storage.objects への直接 SELECT / .list() API) は SELECT policy で制御されるため、
--    "Public can read share images" を削除して anon/authenticated の object 列挙を塞ぐ。
--    src/ grep で .list() 呼び出し 0 件、ShareModal.tsx は upload + getPublicUrl のみ
--    → 削除しても OGP / X 共有 / 公開URL 配信は壊れない。
--    維持される INSERT/UPDATE policy:
--      - "Users can upload own share images" (20260424000001:467, user_id prefix 要求)
--      - "Users can update own share images" (20260424000001:472, 同上)
--    旧 "Authenticated users can upload/update share images" は 20260424000002:21,22 で
--    2026-04-24 に削除済みのため対象外。
-- =============================================================================

DROP POLICY IF EXISTS "Public can read share images" ON storage.objects;


-- =============================================================================
-- ロールバック用 SQL (必要時に手動で流す):
--
--   -- 1. admin RPC: 本体は維持し PUBLIC GRANT のみ戻す (search_path/修飾は残してよい)
--   GRANT EXECUTE ON FUNCTION public.get_users_for_admin() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_user_detail_for_admin(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.update_feedback_status(uuid, text) TO PUBLIC;
--
--   -- 2. Team RPC 戻し
--   GRANT EXECUTE ON FUNCTION public.get_team_my_deck_stats_range(uuid, uuid, date, date, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_team_opponent_deck_stats_range(uuid, uuid, date, date, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_team_deck_detail_stats(uuid, text, text, uuid, date, date) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_team_opponent_deck_detail_stats(uuid, text, text, uuid, date, date) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_team_turn_order_stats_range(uuid, uuid, date, date, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_team_member_summaries(uuid) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_team_deck_trend_range(uuid, uuid, date, date, text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_team_members(uuid) TO PUBLIC;
--
--   -- 3. trigger 関数戻し (直 EXECUTE が必要だった場合)
--   GRANT EXECUTE ON FUNCTION public.normalize_battle_deck_names() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;
--
--   -- 4. share-images SELECT 復元
--   CREATE POLICY "Public can read share images"
--     ON storage.objects FOR SELECT
--     USING (bucket_id = 'share-images');
-- =============================================================================
