-- =============================================================================
-- 20260519000003: admin_update_opponent_deck_name_ja の挙動拡張
--
-- 背景:
--   2026-05-19 のレビュー指摘により、admin 画面で「和名欄を空にしてフォーカス
--   アウト」した場合の希望挙動が変更:
--     旧: name_ja=NULL / name_ja_is_manual=false / name は不変 (= manual override
--         解除のみ、未翻訳状態に戻す)
--     新: name_en を translateDeckName() で再翻訳して name_ja を埋め直す
--         (翻訳結果は server action 側で算出してから RPC に渡す)
--
--   translateDeckName は TS 側の関数なので RPC からは呼べない。よって本 migration
--   は「呼び出し側 (admin-actions.ts) が空入力時に再翻訳結果を組み立てて
--   p_name_ja に詰め直す」前提で、RPC に **明示的 is_manual パラメータ** を追加し、
--   どの保存ルートでも一貫した正規化 / 衝突チェック / battles 同期を保証する。
--
-- 変更:
--   1. 旧シグネチャ admin_update_opponent_deck_name_ja(uuid, text) を DROP
--   2. 新シグネチャ admin_update_opponent_deck_name_ja(uuid, text, boolean) を
--      CREATE (DEFAULT true で旧呼び出し互換)
--   3. RETURN jsonb に name_ja / name_ja_is_manual を追加 (UI ローカル state 同期用)
--   4. p_name_ja 空 + p_is_manual=true: 旧挙動 (manual override 解除 = name_ja
--      NULL / is_manual=false / name 不変)。server action 側で「自動再翻訳でき
--      ない」と判定した時のキャンセルではなく、明示的にこの状態を作りたいケース
--      は今のところ無いが互換のため残す
--   5. p_name_ja 空 + p_is_manual=false: invalid (再翻訳ロジックは server action
--      側に持たせる方針なので RPC からは reject。万一誤呼び出しされても安全)
--   6. p_name_ja 非空: name = stripAllWhitespace(p_name_ja),
--      name_ja = trim(p_name_ja), name_ja_is_manual = p_is_manual
--
-- 注意:
--   Phase E (20260519000002) の admin_update_opponent_deck_name_ja は 2 引数版
--   で REVOKE/GRANT 済みだった。DROP すると GRANT も消えるため、新シグネチャに
--   対して再度 REVOKE/GRANT を発行する。
-- =============================================================================

DROP FUNCTION IF EXISTS public.admin_update_opponent_deck_name_ja(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_update_opponent_deck_name_ja(
  p_id uuid,
  p_name_ja text,
  p_is_manual boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
DECLARE
  v_old_name text;
  v_format text;
  v_game_title text;
  v_trimmed text;
  v_computed_name text;
  v_battles_synced int := 0;
BEGIN
  -- (1) admin 判定: profiles.is_admin = true でない呼び出しは reject
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'forbidden: admin role required (uid=%)', auth.uid();
  END IF;

  -- (2) 既存行取得 (FOR UPDATE で同時更新を排他)
  SELECT name, format, game_title
  INTO v_old_name, v_format, v_game_title
  FROM public.opponent_deck_master
  WHERE id = p_id
  FOR UPDATE;

  IF v_old_name IS NULL THEN
    RAISE EXCEPTION 'opponent_deck_master row not found: id=%', p_id;
  END IF;

  -- (3) name_ja 正規化 (null 防御で coalesce 経由)
  v_trimmed := trim(coalesce(p_name_ja, ''));

  IF v_trimmed = '' THEN
    IF NOT p_is_manual THEN
      -- 空 + auto: server action 側で再翻訳して呼ぶべきルート。空のまま auto
      -- 経路に入るのは誤呼び出しなので reject (UI 側は name_en 欠落時に RPC を
      -- 呼ばない仕様、translateDeckName null 時は p_name_ja=name_en を詰める仕様)
      RAISE EXCEPTION 'invalid: empty p_name_ja with p_is_manual=false (auto path requires regenerated name)';
    END IF;
    -- 空 + manual: 旧 manual override 解除挙動 (name_ja NULL / is_manual false
    -- / name 不変)。新 UI は通常このルートを通らないが互換のため残す
    UPDATE public.opponent_deck_master
    SET name_ja = NULL,
        name_ja_is_manual = false
    WHERE id = p_id;
    RETURN jsonb_build_object(
      'updated_name', v_old_name,
      'old_name', v_old_name,
      'name_ja', NULL,
      'name_ja_is_manual', false,
      'battles_synced', 0,
      'cleared', true
    );
  END IF;

  -- (4) computed_name 算出 (TS stripAllWhitespace と同等パターン)
  v_computed_name := regexp_replace(v_trimmed, '[[:space:]　​-‍﻿]', '', 'g');

  IF v_computed_name = '' THEN
    RAISE EXCEPTION 'name_ja contains only whitespace, computed_name would be empty';
  END IF;

  -- (5) 衝突 pre-check
  IF EXISTS (
    SELECT 1 FROM public.opponent_deck_master
    WHERE name = v_computed_name
      AND format = v_format
      AND game_title = v_game_title
      AND id <> p_id
  ) THEN
    RAISE EXCEPTION
      'name collision: computed_name=%, existing_id=%',
      v_computed_name,
      (SELECT id::text || ' (source=' || source || ', name_en=' || COALESCE(name_en, '') || ')'
       FROM public.opponent_deck_master
       WHERE name = v_computed_name AND format = v_format AND game_title = v_game_title AND id <> p_id
       LIMIT 1);
  END IF;

  -- (6) opponent_deck_master 更新
  UPDATE public.opponent_deck_master
  SET name = v_computed_name,
      name_ja = v_trimmed,
      name_ja_is_manual = p_is_manual
  WHERE id = p_id;

  -- (7) battles 同期 UPDATE (旧 name <> 新 name のみ)
  IF v_old_name IS NOT NULL AND v_old_name <> v_computed_name THEN
    WITH updated AS (
      UPDATE public.battles
      SET opponent_deck_name = v_computed_name
      WHERE format = v_format
        AND game_title = v_game_title
        AND opponent_deck_name = v_old_name
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_battles_synced FROM updated;
  END IF;

  RETURN jsonb_build_object(
    'updated_name', v_computed_name,
    'old_name', v_old_name,
    'name_ja', v_trimmed,
    'name_ja_is_manual', p_is_manual,
    'battles_synced', v_battles_synced,
    'cleared', false
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.admin_update_opponent_deck_name_ja(uuid, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_opponent_deck_name_ja(uuid, text, boolean)
  TO authenticated;
