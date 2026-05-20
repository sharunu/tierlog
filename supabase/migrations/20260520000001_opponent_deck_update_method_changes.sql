-- 対面デッキリスト 更新方式ロジック修正 (Pattern 1 + Pattern 2)
--
-- 詳細設計: docs/plans/2026-05-20_opponent_deck_update_methods.md
--
-- Pattern 1 (管理者依存): auto_add_opponent_deck の新規 INSERT 分岐を分離。
--   未登録デッキ名が対戦記録で入力されたとき、management_mode='admin' のフォーマットでは
--   旧 is_active=false → is_active=true (other/有効) で追加するよう変更。
--   auto は従来通り true、limitless は従来通り false (Pattern 3: limitless 不変)。
--   既存デッキの UPDATE 分岐 (last_used_at 更新 + auto のみ再有効化) は変更しない
--   ── 有効化対象は「master に存在しない未登録デッキの新規追加」のみ。
--
-- Pattern 2 (ユーザー入力依存): _recalculate_opponent_decks_internal に
--   classification_method='fixed_count' (デッキ数固定方式) の分岐を追加。
--   使用数 (battle_count + admin_bonus_count) 降順で上位 major_fixed_count を major、
--   続く minor_fixed_count を minor。使用数 0 のデッキは順位に関わらず other (floor)。
--   固定件数方式は無効化を分類より前に実行 (固定枠を有効デッキだけで埋めるため)。
--   v_denominator=0 早期 return は閾値方式のみに限定 (固定件数方式は分母非依存で、
--   全体 0 件のときも floor + 無効化を実行する必要があるため)。
--   閾値方式の分類・sort_order・無効化ロジックは既存と同一。
--
-- Pattern 3 (limitless依存): apply_limitless_snapshot 等は一切変更しない。
--
-- スキーマ変更なし (classification_method / major_fixed_count / minor_fixed_count は
-- 20260421000001_limitless_sync.sql で追加済)。2 関数の CREATE OR REPLACE のみ。

BEGIN;

-- =============================================================================
-- 1. auto_add_opponent_deck: 新規 INSERT 分岐を admin/auto (有効) と limitless (無効) に分離
-- =============================================================================
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
  v_mode text;
  v_max_sort integer;
  v_is_active boolean;
BEGIN
  IF p_deck_name IS NULL OR length(trim(p_deck_name)) = 0 OR length(p_deck_name) > 80 THEN
    RETURN; -- 不正名はサイレントに skip (battle INSERT は通っているため例外で巻き戻したくない)
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.opponent_deck_settings s
    WHERE s.format = p_format AND s.game_title = p_game_title
  ) THEN
    RETURN; -- format/game 不整合もサイレント skip (RLS WITH CHECK で battle 側が既に保証)
  END IF;

  SELECT management_mode INTO v_mode
  FROM public.opponent_deck_settings
  WHERE format = p_format AND game_title = p_game_title;

  -- 既存デッキ更新 (変更なし): last_used_at 更新 + auto モードのみ無効→有効。
  -- admin / limitless は既存の is_active を据え置く (既存デッキの自動再有効化はしない)。
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

  -- ★ Pattern 1 変更点 (新規 INSERT のみ):
  --   auto      : true  (従来通り)
  --   admin     : true  (旧 false → true。本件の修正)
  --   limitless : false (従来通り。Pattern 3: limitless 不変)
  v_is_active := (v_mode IN ('auto', 'admin'));

  INSERT INTO public.opponent_deck_master
    (name, format, game_title, category, is_active, sort_order, last_used_at)
  VALUES
    (p_deck_name, p_format, p_game_title, 'other', v_is_active, v_max_sort + 10, now());
END;
$func$;

-- trigger (owner 権限) 経由のみ呼ばれる。直接 EXECUTE 経路は付与しない。
REVOKE ALL ON FUNCTION public.auto_add_opponent_deck(text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- =============================================================================
-- 2. _recalculate_opponent_decks_internal: classification_method='fixed_count' 分岐を追加
-- =============================================================================
CREATE OR REPLACE FUNCTION public._recalculate_opponent_decks_internal(
  p_format text,
  p_game_title text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_settings record;
  v_total_battles bigint;
  v_total_bonus bigint;
  v_denominator bigint;
  v_start_date timestamptz;
BEGIN
  SELECT * INTO v_settings
  FROM public.opponent_deck_settings
  WHERE format = p_format AND game_title = p_game_title;

  IF v_settings IS NULL THEN RETURN; END IF;
  IF v_settings.management_mode <> 'auto' THEN RETURN; END IF;

  v_start_date := now() - (v_settings.usage_period_days || ' days')::interval;

  SELECT COUNT(*) INTO v_total_battles
  FROM public.battles
  WHERE format = p_format
    AND game_title = p_game_title
    AND fought_at >= v_start_date;

  SELECT COALESCE(SUM(admin_bonus_count), 0) INTO v_total_bonus
  FROM public.opponent_deck_master
  WHERE format = p_format
    AND game_title = p_game_title
    AND is_active = true;

  v_denominator := v_total_battles + v_total_bonus;

  -- 早期 return は閾値方式のみ: usage_rate の分母に v_denominator を使うため 0 だと除算不能。
  -- 固定件数方式は v_denominator に依存せず、全体 0 件のとき (期間内対戦 0 + admin_bonus 合計 0)
  -- も「0 件デッキは other」floor と無効化を必ず実行する必要があるため早期 return しない。
  IF v_settings.classification_method <> 'fixed_count' AND v_denominator = 0 THEN
    RETURN;
  END IF;

  IF v_settings.classification_method = 'fixed_count' THEN
    -- ===== デッキ数固定方式 =====
    -- (A) 無効化を分類より先に実行: 固定枠を「有効デッキ」だけで埋めるため
    UPDATE public.opponent_deck_master
    SET is_active = false
    WHERE format = p_format
      AND game_title = p_game_title
      AND is_active = true
      AND last_used_at IS NOT NULL
      AND last_used_at < now() - (v_settings.disable_period_days || ' days')::interval;

    UPDATE public.opponent_deck_master
    SET is_active = false
    WHERE format = p_format
      AND game_title = p_game_title
      AND is_active = true
      AND last_used_at IS NULL
      AND created_at < now() - (v_settings.disable_period_days || ' days')::interval;

    -- (B) 使用数 (battle_count + admin_bonus_count) 降順で順位付け。
    --     使用数 0 のデッキは順位に関わらず other (固定枠が余っても昇格させない)。
    WITH deck_usage AS (
      SELECT
        odm.id,
        odm.name,
        (COALESCE(bc.cnt, 0) + odm.admin_bonus_count) AS total_usage
      FROM public.opponent_deck_master odm
      LEFT JOIN (
        SELECT opponent_deck_name, COUNT(*) AS cnt
        FROM public.battles
        WHERE format = p_format
          AND game_title = p_game_title
          AND fought_at >= v_start_date
        GROUP BY opponent_deck_name
      ) bc ON bc.opponent_deck_name = odm.name
      WHERE odm.format = p_format
        AND odm.game_title = p_game_title
        AND odm.is_active = true
    ),
    ranked AS (
      SELECT
        id,
        total_usage,
        ROW_NUMBER() OVER (ORDER BY total_usage DESC, name ASC) AS rn
      FROM deck_usage
    )
    UPDATE public.opponent_deck_master odm
    SET category = CASE
      WHEN r.total_usage = 0 THEN 'other'
      WHEN r.rn <= v_settings.major_fixed_count THEN 'major'
      WHEN r.rn <= v_settings.major_fixed_count + v_settings.minor_fixed_count THEN 'minor'
      ELSE 'other'
    END
    FROM ranked r
    WHERE odm.id = r.id;
  ELSE
    -- ===== 閾値方式 (既存ロジック・変更なし) =====
    WITH deck_usage AS (
      SELECT
        odm.id,
        odm.admin_bonus_count,
        COALESCE(bc.cnt, 0) AS battle_count,
        (COALESCE(bc.cnt, 0) + odm.admin_bonus_count) * 100.0 / v_denominator AS usage_rate
      FROM public.opponent_deck_master odm
      LEFT JOIN (
        SELECT opponent_deck_name, COUNT(*) AS cnt
        FROM public.battles
        WHERE format = p_format
          AND game_title = p_game_title
          AND fought_at >= v_start_date
        GROUP BY opponent_deck_name
      ) bc ON bc.opponent_deck_name = odm.name
      WHERE odm.format = p_format
        AND odm.game_title = p_game_title
        AND odm.is_active = true
    )
    UPDATE public.opponent_deck_master odm
    SET category = CASE
      WHEN du.usage_rate >= v_settings.major_threshold THEN 'major'
      WHEN du.usage_rate >= v_settings.minor_threshold THEN 'minor'
      ELSE 'other'
    END
    FROM deck_usage du
    WHERE odm.id = du.id;
  END IF;

  -- ===== sort_order 振り直し (両方式共通: category 順 → 使用数降順 → 名前順) =====
  WITH ranked AS (
    SELECT
      odm.id,
      ROW_NUMBER() OVER (
        ORDER BY
          CASE odm.category WHEN 'major' THEN 0 WHEN 'minor' THEN 1 ELSE 2 END,
          (COALESCE(bc.cnt, 0) + odm.admin_bonus_count) DESC,
          odm.name ASC
      ) AS new_order
    FROM public.opponent_deck_master odm
    LEFT JOIN (
      SELECT opponent_deck_name, COUNT(*) AS cnt
      FROM public.battles
      WHERE format = p_format
        AND game_title = p_game_title
        AND fought_at >= v_start_date
      GROUP BY opponent_deck_name
    ) bc ON bc.opponent_deck_name = odm.name
    WHERE odm.format = p_format
      AND odm.game_title = p_game_title
      AND odm.is_active = true
  )
  UPDATE public.opponent_deck_master odm
  SET sort_order = r.new_order
  FROM ranked r
  WHERE odm.id = r.id;

  -- ===== 閾値方式のみ最後に無効化 (fixed_count は (A) で実施済) =====
  IF v_settings.classification_method <> 'fixed_count' THEN
    UPDATE public.opponent_deck_master
    SET is_active = false
    WHERE format = p_format
      AND game_title = p_game_title
      AND is_active = true
      AND last_used_at IS NOT NULL
      AND last_used_at < now() - (v_settings.disable_period_days || ' days')::interval;

    UPDATE public.opponent_deck_master
    SET is_active = false
    WHERE format = p_format
      AND game_title = p_game_title
      AND is_active = true
      AND last_used_at IS NULL
      AND created_at < now() - (v_settings.disable_period_days || ' days')::interval;
  END IF;
END;
$func$;

REVOKE ALL ON FUNCTION public._recalculate_opponent_decks_internal(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._recalculate_opponent_decks_internal(text, text)
  TO service_role;

COMMIT;
