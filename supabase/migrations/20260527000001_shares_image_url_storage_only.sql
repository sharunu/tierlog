-- Plan A A-1: shares.image_url を Supabase Storage share-images/<user_id>/... に限定する
-- BEFORE INSERT/UPDATE trigger と、補助 helper / validate_app_settings 強化。
--
-- 適用前提:
--   public.app_settings に key='storage_public_url_prefix' の行が **先に INSERT 済み** であること。
--   prefix 値の形式は 'https://<project>.supabase.co/storage/v1/object/public/share-images/'
--   (末尾 slash 必須)。
--
-- 設計:
--   - DB trigger と display sanitizer (src/lib/share/image-url.ts) の二段防御 (RD-2)。
--   - prefix 未設定時は fail-closed: is_safe_share_image_url が RAISE EXCEPTION し、
--     shares への新規 INSERT/UPDATE を全件拒否する。
--   - app_settings 行 INSERT は trigger 適用より先に行う運用 (Plan A §A-1 順序ステップ 1, 9)。
--     trigger 適用後に validate_app_settings の新分岐で値が再評価される。

-- =============================================================================
-- 1. validate_app_settings に storage_public_url_prefix 検証分岐を追加
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_app_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_days integer;
  v_prefix text;
BEGIN
  IF NEW.key = 'share_retention_days' THEN
    -- 既存検証 (20260515000001 から維持)
    IF pg_catalog.jsonb_typeof(NEW.value) <> 'number' THEN
      RAISE EXCEPTION 'share_retention_days は jsonb number 型で指定してください。実際の型: %', pg_catalog.jsonb_typeof(NEW.value);
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

  IF NEW.key = 'storage_public_url_prefix' THEN
    IF pg_catalog.jsonb_typeof(NEW.value) <> 'string' THEN
      RAISE EXCEPTION 'storage_public_url_prefix は jsonb scalar string で指定してください。実際の型: %', pg_catalog.jsonb_typeof(NEW.value);
    END IF;
    v_prefix := (NEW.value#>>'{}');
    IF v_prefix IS NULL OR v_prefix = '' THEN
      RAISE EXCEPTION 'storage_public_url_prefix は空文字を許容しません';
    END IF;
    IF pg_catalog.left(v_prefix, 8) <> 'https://' THEN
      RAISE EXCEPTION 'storage_public_url_prefix は https:// で始まる必要があります。実際: %', v_prefix;
    END IF;
    IF pg_catalog.right(v_prefix, pg_catalog.length('/storage/v1/object/public/share-images/'))
       <> '/storage/v1/object/public/share-images/' THEN
      RAISE EXCEPTION 'storage_public_url_prefix は /storage/v1/object/public/share-images/ (末尾 slash) で終わる必要があります。実際: %', v_prefix;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.validate_app_settings() FROM PUBLIC, anon, authenticated, service_role;

-- 既存行に新 validation を強制再評価 (RD-2 / 第 2 回 Codex 指摘 2 案 (a))。
-- BEFORE UPDATE trigger を発火させる no-op UPDATE。違反値が入っていれば本 migration が
-- RAISE EXCEPTION で abort する。
UPDATE public.app_settings SET value = value WHERE key = 'storage_public_url_prefix';

-- =============================================================================
-- 2. is_safe_share_image_url helper (SECURITY DEFINER, search_path 厳格)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_safe_share_image_url(p_image_url text, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prefix text;
  v_rest text;
  v_first_slash integer;
  v_first_segment text;
  v_remainder text;
BEGIN
  -- image_url IS NULL は許可 (画像なし share、OG fallback 経路)
  IF p_image_url IS NULL THEN
    RETURN true;
  END IF;

  -- prefix を app_settings から取得 (fail-closed: 未設定なら全 INSERT/UPDATE を拒否)
  SELECT (s.value#>>'{}') INTO v_prefix
  FROM public.app_settings AS s
  WHERE s.key = 'storage_public_url_prefix';

  IF v_prefix IS NULL OR v_prefix = '' THEN
    RAISE EXCEPTION 'storage_public_url_prefix not configured in app_settings';
  END IF;

  -- query / fragment 拒否 (Storage public URL に query/fragment は付かない)
  IF pg_catalog.strpos(p_image_url, '?') > 0 THEN
    RETURN false;
  END IF;
  IF pg_catalog.strpos(p_image_url, '#') > 0 THEN
    RETURN false;
  END IF;

  -- prefix 一致
  IF pg_catalog.substring(p_image_url, 1, pg_catalog.length(v_prefix)) <> v_prefix THEN
    RETURN false;
  END IF;

  -- pathname 解析: prefix 除去後の 1 階層目が p_user_id と完全一致
  v_rest := pg_catalog.substring(p_image_url, pg_catalog.length(v_prefix) + 1);
  IF v_rest IS NULL OR v_rest = '' THEN
    RETURN false;
  END IF;
  v_first_slash := pg_catalog.strpos(v_rest, '/');
  IF v_first_slash IS NULL OR v_first_slash <= 1 THEN
    RETURN false;
  END IF;
  v_first_segment := pg_catalog.substring(v_rest, 1, v_first_slash - 1);
  IF v_first_segment <> p_user_id::text THEN
    RETURN false;
  END IF;

  -- 2 階層目以降が空でないこと
  v_remainder := pg_catalog.substring(v_rest, v_first_slash + 1);
  IF v_remainder IS NULL OR v_remainder = '' THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.is_safe_share_image_url(text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- 3. shares BEFORE INSERT/UPDATE trigger
-- =============================================================================

CREATE OR REPLACE FUNCTION public.shares_validate_image_url_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_safe_share_image_url(NEW.image_url, NEW.user_id) THEN
    RAISE EXCEPTION 'shares.image_url must point to share-images/<user_id>/ under storage_public_url_prefix (got: %)', NEW.image_url;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.shares_validate_image_url_trigger() FROM PUBLIC, anon, authenticated, service_role;

-- 既存 shares_derive_image_path (BEFORE INSERT/UPDATE, alphabetical 順で d < v)
-- が先に走って image_path を派生、その後 validate trigger が image_url を検証する。
DROP TRIGGER IF EXISTS shares_validate_image_url ON public.shares;
CREATE TRIGGER shares_validate_image_url
BEFORE INSERT OR UPDATE ON public.shares
FOR EACH ROW EXECUTE FUNCTION public.shares_validate_image_url_trigger();

-- =============================================================================
-- 4. storage_public_url_prefix 行存在チェック (運用ミス検出)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'storage_public_url_prefix') THEN
    RAISE EXCEPTION 'storage_public_url_prefix row missing in app_settings — INSERT it before applying this migration (see Plan A §A-1 ステップ 1 / 9)';
  END IF;
END $$;
