-- Plan D / D-1: account_access_state(uid uuid) returns text
--
-- 背景:
--   統合 audit §4.2: BAN / suspended / unpaid / canceled 等の account state を
--   単一の DB 関数で集約し、書き込み系 RLS / 重要 RPC / API route で AND する土台。
--   短期は stage=4 を 'banned' として拒否、将来 Phase 3 の Stripe 連携で
--   'suspended' / 'unpaid' / 'canceled' / 'past_due' を同関数の内部のみで追加可能にする。
--
-- 設計:
--   - 戻り値 text: RD-D1 により案 B 採用。POLICY 側は `= 'active'` で固定し、
--     関数内部の変更だけで Stripe / billing 拡張に対応できる。
--   - admin 例外: RD-D1-A により本関数内で public.profiles.is_admin を直接 SELECT する
--     (is_admin_user(p_uid uuid) overload は本 plan では作らない。is_admin_user 既存版は
--     auth.uid() 専用なので任意 uid に対する admin 判定を別関数化すると影響範囲が広い)。
--     COALESCE(is_admin, false) で NULL を false 扱い。
--   - STABLE: 同一 transaction 内で同じ uid に対して同じ結果を返す。stage / is_admin が
--     transaction 中に変わる可能性は実運用ゼロ近く、安全側に STABLE。
--   - SECURITY DEFINER + SET search_path = '': 既存 SECDEF hardening 規約準拠
--     (20260509000004_secdef_hardening_phase_a.sql 等と同じ書式)。
--   - 戻り値:
--     - 'unauthenticated': p_uid IS NULL
--     - 'unknown'        : profiles 行が存在しない (auth.users にはあるが profiles 未作成)
--     - 'banned'         : stage = 4 かつ非 admin
--     - 'active'         : それ以外 (stage 1-3 または admin)
--     - reserved (Phase 3): 'suspended' / 'unpaid' / 'canceled' / 'past_due'
--
-- 検証ポイント:
--   - SELECT public.account_access_state(NULL) → 'unauthenticated'
--   - SELECT public.account_access_state(<stage1 uid>) → 'active'
--   - SELECT public.account_access_state(<stage4 uid>) → 'banned'
--   - SELECT public.account_access_state(<admin uid stage=4>) → 'active' (admin 例外)
--   - SELECT public.account_access_state('00000000-...') → 'unknown' (行不在)
--   - anon ロールから EXECUTE 不可 (REVOKE で明示)

CREATE OR REPLACE FUNCTION public.account_access_state(p_uid uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage int;
  v_is_admin boolean;
BEGIN
  IF p_uid IS NULL THEN
    RETURN 'unauthenticated';
  END IF;

  SELECT COALESCE(is_admin, false), stage
    INTO v_is_admin, v_stage
    FROM public.profiles
    WHERE id = p_uid;

  IF NOT FOUND OR v_stage IS NULL THEN
    -- profiles 行が存在しない (auth.users にはあるが profiles レコード未作成等)
    RETURN 'unknown';
  END IF;

  -- RD-D3-1: admin は stage に関わらず active 相当扱い。
  -- 誤 stage=4 になった admin でも管理画面からの復旧経路を残す。
  IF v_is_admin THEN
    RETURN 'active';
  END IF;

  IF v_stage = 4 THEN
    RETURN 'banned';
  END IF;

  -- 将来 reserved state (Phase 3): 'suspended' / 'unpaid' / 'canceled' / 'past_due'
  RETURN 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.account_access_state(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_access_state(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.account_access_state(uuid) IS
  'Returns the account access state for the given user. Used by write-side RLS and important RPCs to gate stage=4 (banned) and future unpaid/canceled states. Admin users (profiles.is_admin = true) bypass stage check and always return ''active'' (RD-D3-1). Reads profiles.is_admin directly without using is_admin_user() overload (RD-D1-A). SECURITY DEFINER + SET search_path = '''' (既存 secdef hardening 規約準拠). Plan D / D-1.';
