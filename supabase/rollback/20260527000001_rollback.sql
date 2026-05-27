-- Rollback for 20260527000001_shares_image_url_storage_only.sql (Plan A A-1)
-- 適用: trigger / helper を削除し、validate_app_settings を 20260515000001 と同等の旧版に戻す。
-- 注意: app_settings の storage_public_url_prefix 行は残置する (display sanitizer 側でも使うため、
-- 完全削除はしない)。必要なら手動で DELETE する。

-- =============================================================================
-- 1. shares BEFORE INSERT/UPDATE trigger を削除
-- =============================================================================
DROP TRIGGER IF EXISTS shares_validate_image_url ON public.shares;
DROP FUNCTION IF EXISTS public.shares_validate_image_url_trigger();

-- =============================================================================
-- 2. is_safe_share_image_url helper を削除
-- =============================================================================
DROP FUNCTION IF EXISTS public.is_safe_share_image_url(text, uuid);

-- =============================================================================
-- 3. validate_app_settings を 20260515000001 時点 (share_retention_days のみ) に戻す
-- =============================================================================
CREATE OR REPLACE FUNCTION public.validate_app_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
BEGIN
  IF NEW.key = 'share_retention_days' THEN
    IF jsonb_typeof(NEW.value) <> 'number' THEN
      RAISE EXCEPTION 'share_retention_days は jsonb number 型で指定してください。実際の型: %', jsonb_typeof(NEW.value);
    END IF;
    BEGIN
      v_days := (NEW.value#>>'{}')::integer;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'share_retention_days を integer に変換できません: %', NEW.value;
    END;
    IF v_days < 1 OR v_days > 3650 THEN
      RAISE EXCEPTION 'share_retention_days は 1〜3650 の範囲で指定してください。実際: %', v_days;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_app_settings() FROM PUBLIC, anon, authenticated, service_role;
