import { createClient } from "@/lib/supabase/client";
import { DEFAULT_GAME, type GameSlug } from "@/lib/games";
import type { BattleResult } from "@/lib/battle/result-format";

export async function recordBattle(formData: {
  myDeckId: string;
  myDeckName: string;
  opponentDeckName: string;
  result: BattleResult;
  turnOrder: "first" | "second" | null;
  format: string;
  game?: GameSlug;
  tuningId?: string | null;
  tuningName?: string | null;
  opponentMemo?: string | null;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const game: GameSlug = formData.game ?? DEFAULT_GAME;

  const { error } = await supabase.from("battles").insert({
    user_id: user.id,
    my_deck_id: formData.myDeckId,
    my_deck_name: formData.myDeckName,
    opponent_deck_name: formData.opponentDeckName,
    result: formData.result,
    turn_order: formData.turnOrder,
    format: formData.format,
    game_title: game,
    tuning_id: formData.tuningId ?? null,
    tuning_name: formData.tuningName ?? null,
    opponent_memo: formData.opponentMemo || null,
  });

  if (error) throw new Error(error.message);

  // 未登録デッキ自動追加 / last_used_at更新は battles AFTER INSERT trigger
  // (battles_auto_add_opponent_deck, PR6 Phase 6a で導入) が代行する
}

export async function updateBattle(
  id: string,
  fields: {
    opponentDeckName?: string;
    result?: BattleResult;
    turnOrder?: "first" | "second" | null;
    myDeckId?: string;
    myDeckName?: string;
    tuningId?: string | null;
    tuningName?: string | null;
    opponentMemo?: string | null;
  }
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const updateData: Record<string, unknown> = {};
  if (fields.result !== undefined) updateData.result = fields.result;
  if (fields.turnOrder !== undefined) updateData.turn_order = fields.turnOrder;
  if (fields.opponentDeckName !== undefined) {
    updateData.opponent_deck_name = fields.opponentDeckName;
  }

  if (fields.myDeckId !== undefined) updateData.my_deck_id = fields.myDeckId;
  if (fields.myDeckName !== undefined) updateData.my_deck_name = fields.myDeckName;
  if (fields.tuningId !== undefined) updateData.tuning_id = fields.tuningId;
  if (fields.tuningName !== undefined) updateData.tuning_name = fields.tuningName;
  if (fields.opponentMemo !== undefined) updateData.opponent_memo = fields.opponentMemo;

  const { error } = await supabase
    .from("battles")
    .update(updateData)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}

export async function deleteBattle(id: string) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("battles")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}

export async function getRecentBattles(limit = 50, format: string, game: GameSlug = DEFAULT_GAME) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("battles")
    .select("*")
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("format", format)
    .order("fought_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

export type DeckSuggestions = { major: string[]; minor: string[]; other: string[] };

export async function getOpponentDeckSuggestions(format: string, _game: GameSlug = DEFAULT_GAME) {
  const supabase = createClient();
  // format コードがゲーム間で重複しないため、p_format フィルタのみで正しく絞り込まれる
  const { data } = await supabase.rpc("get_opponent_deck_suggestions", {
    p_format: format,
  });
  const rows = (data as { deck_name: string; deck_category: string }[] | null) ?? [];
  return {
    major: rows.filter(r => r.deck_category === "major").map(r => r.deck_name),
    minor: rows.filter(r => r.deck_category === "minor").map(r => r.deck_name),
    other: rows.filter(r => r.deck_category === "other").map(r => r.deck_name),
  };
}

export async function getMiniStats(format: string, sinceTimestamp?: string, game: GameSlug = DEFAULT_GAME) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  let query = supabase
    .from("battles")
    .select("result, fought_at")
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("format", format)
    .order("fought_at", { ascending: false });

  if (sinceTimestamp) {
    query = query.gte("fought_at", sinceTimestamp);
  }

  const { data: battles } = await query;

  if (!battles || battles.length === 0) return null;

  const wins = battles.filter((b) => b.result === "win").length;
  const losses = battles.filter((b) => b.result === "loss").length;
  const draws = battles.filter((b) => b.result === "draw").length;
  const total = battles.length;

  // DRAW は連勝カウンタを維持（継続）、LOSS でのみ中断
  let streak = 0;
  for (const b of battles) {
    if (b.result === "win") streak++;
    else if (b.result === "draw") continue;
    else break;
  }

  return { wins, losses, draws, total, streak };
}

export async function getAllBattles(format: string, game: GameSlug = DEFAULT_GAME) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("battles")
    .select("id, opponent_deck_name, result, fought_at, my_deck_name")
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("format", format)
    .order("fought_at", { ascending: false });

  return data ?? [];
}

export async function getBattlesByDateRange(format: string, startDate: string, endDate: string, game: GameSlug = DEFAULT_GAME) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const endPlusOne = new Date(endDate);
  endPlusOne.setDate(endPlusOne.getDate() + 1);
  const { data } = await supabase
    .from("battles")
    .select("*")
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("format", format)
    .gte("fought_at", startDate)
    .lt("fought_at", endPlusOne.toISOString().split("T")[0])
    .order("fought_at", { ascending: false });
  return data ?? [];
}

export async function hasAnyBattles(format: string, game: GameSlug = DEFAULT_GAME): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { count } = await supabase
    .from("battles")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("format", format);
  return (count ?? 0) > 0;
}

export async function getOpponentMemoSuggestions(opponentDeckName: string, game: GameSlug = DEFAULT_GAME): Promise<string[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("battles")
    .select("opponent_memo")
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("opponent_deck_name", opponentDeckName)
    .not("opponent_memo", "is", null)
    .order("fought_at", { ascending: false });
  if (!data) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const row of data) {
    const memo = (row.opponent_memo as string).trim();
    if (memo && !seen.has(memo)) { seen.add(memo); result.push(memo); }
  }
  return result;
}

export async function deleteOpponentMemoSuggestion(opponentDeckName: string, memoText: string, game: GameSlug = DEFAULT_GAME): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { error } = await supabase
    .from("battles")
    .update({ opponent_memo: null })
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("opponent_deck_name", opponentDeckName)
    .eq("opponent_memo", memoText);
  return !error;
}

export async function getDailyBattleCounts(format: string, year: number, month: number, game: GameSlug = DEFAULT_GAME) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return {};
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = month === 12 ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
  const endDate = nextMonth.toISOString().split("T")[0];
  const { data } = await supabase
    .from("battles")
    .select("fought_at")
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("format", format)
    .gte("fought_at", startDate)
    .lt("fought_at", endDate);
  const counts: Record<string, number> = {};
  for (const b of (data ?? [])) {
    const day = new Date(b.fought_at).toLocaleDateString("sv-SE");
    counts[day] = (counts[day] || 0) + 1;
  }
  return counts;
}
