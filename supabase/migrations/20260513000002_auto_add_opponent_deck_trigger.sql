-- PR6 Phase 6a (Phase 2 hardening): battles AFTER INSERT trigger を追加
--
-- 本 Phase は trigger 追加のみで auto_add_opponent_deck() 本体や authenticated EXECUTE grant は
-- 変更しない。Phase 6b で client 側の rpc 呼び出しを削除し、Phase 6c で REVOKE + body 簡素化を行う。
-- 3 Phase 分割の理由は plan の PR6 説明参照 (旧コードが直接 rpc を呼ぶ間に REVOKE すると
-- permission denied で battle 記録が壊れるため)。

-- 1. battles INSERT trigger を追加 (UPDATE は対象外: UPDATE での deck name 改変は
--    既存 normalize_battle_deck_names trigger により制約あり、また通常 UX フローは INSERT)
CREATE OR REPLACE FUNCTION public.trg_battles_auto_add_opponent_deck()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.auto_add_opponent_deck(
    NEW.opponent_deck_name,
    NEW.format,
    NEW.game_title
  );
  RETURN NULL; -- AFTER trigger return value 無視
END;
$$;
REVOKE EXECUTE ON FUNCTION public.trg_battles_auto_add_opponent_deck() FROM PUBLIC, anon, authenticated, service_role;
-- trigger 経由のみ。owner 権限で動く。

DROP TRIGGER IF EXISTS battles_auto_add_opponent_deck ON public.battles;
CREATE TRIGGER battles_auto_add_opponent_deck
AFTER INSERT ON public.battles
FOR EACH ROW EXECUTE FUNCTION public.trg_battles_auto_add_opponent_deck();

-- 注: auto_add_opponent_deck() 本体は変更しない。authenticated EXECUTE grant も維持。
-- Phase 6b で client 側の rpc 呼び出しを削除し、Phase 6c で REVOKE + body 簡素化を行う。
