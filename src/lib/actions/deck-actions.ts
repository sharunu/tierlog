import { createClient } from "@/lib/supabase/client";
import { DEFAULT_GAME, type GameSlug } from "@/lib/games";
import { stripAllWhitespace } from "@/lib/util/whitespace";

export async function getDecks(format: string, game: GameSlug = DEFAULT_GAME) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("decks")
    .select("*, deck_tunings(id, name, sort_order)")
    .eq("user_id", user.id)
    .eq("is_archived", false)
    .eq("game_title", game)
    .eq("format", format)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  return (data ?? []).map((d) => ({
    ...d,
    deck_tunings: (d.deck_tunings ?? []).sort((a, b) => a.sort_order - b.sort_order),
  }));
}

export async function createDeck(name: string, format: string, game: GameSlug = DEFAULT_GAME) {
  // デッキ名から全空白 (半角/全角/タブ/改行/zero-width) を削除。
  // UI 側でも事前 sanitize するが、API 直叩き対策として server actions 側でも防御する。
  const cleaned = stripAllWhitespace(name.trim());
  if (cleaned.length === 0) {
    throw new Error("デッキ名を入力してください");
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: existing } = await supabase
    .from("decks")
    .select("id")
    .eq("user_id", user.id)
    .eq("game_title", game)
    .eq("name", cleaned)
    .eq("format", format)
    .eq("is_archived", false)
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error("同じ名前のデッキが既に登録されています");
  }

  const { data, error } = await supabase
    .from("decks")
    .insert({ user_id: user.id, name: cleaned, format, game_title: game })
    .select("*, deck_tunings(id, name, sort_order)")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateDeck(id: string, name: string) {
  // デッキ名から全空白を削除 (server actions 側の最終防衛)
  const cleaned = stripAllWhitespace(name.trim());
  if (cleaned.length === 0) {
    throw new Error("デッキ名を入力してください");
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: deck } = await supabase.from("decks").select("format, game_title").eq("id", id).single();
  if (!deck) throw new Error("Deck not found");

  const { data: dup } = await supabase
    .from("decks")
    .select("id")
    .eq("user_id", user.id)
    .eq("game_title", deck.game_title)
    .eq("name", cleaned)
    .eq("format", deck.format)
    .eq("is_archived", false)
    .neq("id", id)
    .limit(1);

  if (dup && dup.length > 0) {
    throw new Error("同じ名前のデッキが既に登録されています");
  }

  const { error } = await supabase.from("decks").update({ name: cleaned }).eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
}

export async function archiveDeck(id: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { error } = await supabase
    .from("decks")
    .update({ is_archived: true })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}

export async function reorderDecks(deckIds: string[]) {
  const supabase = createClient();
  const updates = deckIds.map((id, index) =>
    supabase.from("decks").update({ sort_order: index }).eq("id", id)
  );
  await Promise.all(updates);
}

export async function createTuning(deckId: string, name: string) {
  const supabase = createClient();

  const { data: dup } = await supabase
    .from("deck_tunings")
    .select("id")
    .eq("deck_id", deckId)
    .eq("name", name)
    .limit(1);

  if (dup && dup.length > 0) {
    throw new Error("同じ名前のチューニングが既に登録されています");
  }

  const { data: existing } = await supabase
    .from("deck_tunings")
    .select("sort_order")
    .eq("deck_id", deckId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("deck_tunings")
    .insert({ deck_id: deckId, name, sort_order: nextOrder })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateTuning(id: string, name: string) {
  const supabase = createClient();

  const { data: current } = await supabase.from("deck_tunings").select("deck_id").eq("id", id).single();
  if (!current) throw new Error("Tuning not found");

  const { data: dup } = await supabase
    .from("deck_tunings")
    .select("id")
    .eq("deck_id", current.deck_id)
    .eq("name", name)
    .neq("id", id)
    .limit(1);

  if (dup && dup.length > 0) {
    throw new Error("同じ名前のチューニングが既に登録されています");
  }

  const { error } = await supabase.from("deck_tunings").update({ name }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTuning(id: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("deck_tunings")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}
