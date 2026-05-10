-- handle_new_user(): 自動付与デッキ名を opponent_deck_master.name_ja で日本語化
-- 20260510000001 で WHERE 句を IN ('dm','pokepoke') に拡張済 → さらに pokepoke の
-- name 英語問題を解消する。
-- データ仕様:
--   - dm: name = 日本語 / name_ja = 日本語 (manual seed) → 変化なし
--   - pokepoke: name = 英語 (Limitless 由来) / name_ja = 日本語 (translateDeckName 経由)
-- 既存 UI の displayDeckName() (src/lib/actions/opponent-deck-display.ts) と同じ
-- COALESCE(name_ja, name) パターンを SQL でも適用し、name_ja があれば日本語、
-- なければ name にフォールバック (Limitless sync 未実行 row 等の保険)。
-- SECURITY DEFINER / SET search_path = '' / public. プレフィックス は完全維持。

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, is_guest)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'name'),
    NEW.is_anonymous
  );

  IF NOT NEW.is_anonymous THEN
    INSERT INTO public.decks (user_id, name, format, game_title, sort_order)
    SELECT NEW.id, COALESCE(odm.name_ja, odm.name), odm.format, odm.game_title, odm.sort_order
    FROM public.opponent_deck_master odm
    WHERE odm.category = 'major'
      AND odm.is_active = true
      AND odm.game_title IN ('dm', 'pokepoke')
    ORDER BY odm.game_title, odm.format, odm.sort_order;
  END IF;

  RETURN NEW;
END;
$$;

-- Phase A (20260509000004) で REVOKE 済の権限状態を migration に明文化
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
