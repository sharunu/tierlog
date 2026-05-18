/**
 * LimitlessTCG からのデッキデータ取り込み共通ロジック。
 *
 * /api/internal/limitless-sync (cron, X-Internal-Key 認証) と
 * /api/admin/limitless-sync    (管理者 UI, session + checkIsAdmin) の両方から呼ばれる。
 *
 * API キー受領までは HTML スクレイピングを停止し、既存キャッシュのみ利用する。
 * 再開時の処理:
 *   1. 多重実行防止: 直近 60 秒以内に同期済みなら skipped を返す (force=true で無視)
 *   2. play.limitlesstcg.com/decks?game=POCKET&format=standard を取得
 *   3. parseDeckTable で行配列化
 *   4. translateDeckName で各デッキ名を日本語化
 *   5. apply_limitless_snapshot RPC を RANKED / RANDOM 両方に対して実行
 *   6. エラー時は mark_limitless_sync_error RPC で状態を記録
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/cf-env";
import { stripAllWhitespace } from "@/lib/util/whitespace";
import { parseDeckTable, LimitlessRow } from "./limitless-parser";
import { translateDeckName } from "./deck-translator";

const LIMITLESS_URL =
  "https://play.limitlesstcg.com/decks?game=POCKET&format=standard";
const USER_AGENT = "duepure-tracker/0.1 (+https://github.com/sharunu/duepure-tracker)";
const GAME_TITLE = "pokepoke";
const TARGET_FORMATS = ["RANKED", "RANDOM"] as const;
const RECENT_SYNC_GUARD_SECONDS = 60;
const LIMITLESS_HTML_SYNC_PAUSED = true;
const LIMITLESS_HTML_SYNC_PAUSED_REASON =
  "Limitless HTML scraping is paused while waiting for official API access approval";

export type SyncResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; fetched: number; synced_at: string }
  | { ok: false; error: string };

export async function runLimitlessSync(
  opts: { force?: boolean } = {},
): Promise<SyncResult> {
  if (LIMITLESS_HTML_SYNC_PAUSED) {
    return {
      ok: true,
      skipped: true,
      reason: LIMITLESS_HTML_SYNC_PAUSED_REASON,
    };
  }

  const supabase = await createServiceRoleClient();
  if (!supabase) {
    return { ok: false, error: "supabase configuration missing" };
  }

  if (!opts.force) {
    const guard = await isRecentlySynced(supabase);
    if (guard.recent) {
      return {
        ok: true,
        skipped: true,
        reason: `already synced within ${RECENT_SYNC_GUARD_SECONDS}s (last: ${guard.lastSyncedAt})`,
      };
    }
  }

  let html: string;
  try {
    html = await fetchLimitlessHtml();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markError(supabase, `fetch_failed`, msg);
    return { ok: false, error: `fetch failed: ${msg}` };
  }

  let rows: LimitlessRow[];
  try {
    rows = parseDeckTable(html);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markError(supabase, `parse_failed`, msg);
    return { ok: false, error: `parse failed: ${msg}` };
  }

  if (rows.length === 0) {
    await markError(supabase, `parse_empty`, "no deck rows found in HTML");
    return { ok: false, error: "no deck rows" };
  }

  const translated = rows.map((r) => {
    const nameJa = translateDeckName(r.name_en);
    // name_ja は表示名のため全空白削除する。name_en は Limitless 内部キーなので触らない。
    const cleanedNameJa = nameJa ? stripAllWhitespace(nameJa) : null;
    return {
      name_en: r.name_en,
      name_ja: cleanedNameJa,
      share: r.share,
      count: r.count,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      win_pct: r.win_pct,
      icon_urls: r.icon_urls,
      slug: r.slug,
    };
  });

  const synced_at = new Date().toISOString();
  for (const format of TARGET_FORMATS) {
    const { error } = await supabase.rpc("apply_limitless_snapshot", {
      p_game_title: GAME_TITLE,
      p_format: format,
      p_rows: translated,
      p_synced_at: synced_at,
    });
    if (error) {
      await markError(supabase, `rpc_failed`, `${format}: ${error.message}`);
      return {
        ok: false,
        error: `apply_limitless_snapshot failed for ${format}: ${error.message}`,
      };
    }
  }

  return { ok: true, skipped: false, fetched: rows.length, synced_at };
}

async function fetchLimitlessHtml(): Promise<string> {
  const attempt = async () => {
    const res = await fetch(LIMITLESS_URL, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.text();
  };

  try {
    return await attempt();
  } catch (e) {
    console.warn("limitless fetch retry after error:", e);
    await new Promise((r) => setTimeout(r, 5000));
    return await attempt();
  }
}

async function isRecentlySynced(
  supabase: SupabaseClient,
): Promise<{ recent: boolean; lastSyncedAt: string | null }> {
  const { data, error } = await supabase
    .from("opponent_deck_settings")
    .select("limitless_last_synced_at")
    .eq("game_title", GAME_TITLE)
    .in("format", [...TARGET_FORMATS]);

  if (error || !data) return { recent: false, lastSyncedAt: null };

  const latest = data
    .map((r) => r.limitless_last_synced_at as string | null)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1);

  if (!latest) return { recent: false, lastSyncedAt: null };

  const ageMs = Date.now() - new Date(latest).getTime();
  return {
    recent: ageMs < RECENT_SYNC_GUARD_SECONDS * 1000,
    lastSyncedAt: latest,
  };
}

async function markError(
  supabase: SupabaseClient,
  status: string,
  message: string,
): Promise<void> {
  for (const format of TARGET_FORMATS) {
    await supabase.rpc("mark_limitless_sync_error", {
      p_game_title: GAME_TITLE,
      p_format: format,
      p_status: `error:${status}`,
      p_message: message.slice(0, 500),
    });
  }
}

async function createServiceRoleClient(): Promise<SupabaseClient | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = await getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
