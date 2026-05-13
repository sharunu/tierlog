-- PR9 Phase 9b-3: recalc_shares_expires_at_on_retention_change trigger に WHERE 句追加
--
-- Phase 9a で投入した recalc_shares_expires_at_on_retention_change() の本体内
-- `UPDATE public.shares SET expires_at = ...` には WHERE 句が無く、Supabase の
-- pg_safeupdate 拡張 (authenticator / service_role 経由の UPDATE/DELETE に WHERE 必須を強制)
-- により PostgREST 経由で発火させると "UPDATE requires a WHERE clause" を返す事象が出た。
--
-- 直接 psql 接続では postgres role を使うため safeupdate が効かず、Phase 9a の smoke では
-- 通過していたが、Phase 9b の /api/admin/settings POST (service_role 経由) で発覚した。
--
-- 修正: 実際に更新が必要な行だけを WHERE で限定する。
--   1. pg_safeupdate を通過させる (WHERE 句を付与)
--   2. 同時に「既に正しい行」をスキップできるため余計な書き込みを減らす副次効果あり
--
-- trigger 定義 (app_settings_recalc_shares_expires_at) はそのまま残し、function 本体のみ
-- CREATE OR REPLACE で差し替える。

CREATE OR REPLACE FUNCTION public.recalc_shares_expires_at_on_retention_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
BEGIN
  IF NEW.key <> 'share_retention_days' THEN RETURN NEW; END IF;
  v_days := (NEW.value#>>'{}')::integer;
  IF v_days IS NULL THEN RETURN NEW; END IF;
  UPDATE public.shares
     SET expires_at = created_at + make_interval(days => v_days)
   WHERE expires_at IS DISTINCT FROM created_at + make_interval(days => v_days);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.recalc_shares_expires_at_on_retention_change() FROM PUBLIC, anon, authenticated, service_role;
