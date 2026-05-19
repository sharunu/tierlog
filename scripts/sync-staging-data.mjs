#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const PAGE_SIZE = 1000;
const WRITE_BATCH_SIZE = 500;
const DELETE_BATCH_SIZE = 100;
const DEFAULT_STAGING_REF = "uqndrkaxmbfjuiociuns";

const GLOBAL_TABLES = [
  {
    table: "opponent_deck_settings",
    keyColumns: ["format", "game_title"],
    stripColumns: ["id"],
    deleteColumn: "id",
  },
  {
    table: "opponent_deck_master",
    keyColumns: ["name", "format", "game_title"],
    stripColumns: ["id"],
    deleteColumn: "id",
  },
  {
    table: "detection_rules",
    keyColumns: ["rule_key"],
    stripColumns: ["id"],
    deleteColumn: "id",
  },
  {
    table: "quality_scoring_rules",
    keyColumns: ["rule_key"],
    stripColumns: ["id"],
    deleteColumn: "id",
  },
  {
    table: "quality_scoring_settings",
    keyColumns: ["key"],
    stripColumns: [],
    deleteColumn: "key",
  },
];

function usage() {
  console.log(`
Usage:
  node scripts/sync-staging-data.mjs --globals [--apply]
  node scripts/sync-staging-data.mjs --user [--apply]
  node scripts/sync-staging-data.mjs --all [--apply]

Required environment:
  PROD_SUPABASE_URL
  PROD_SUPABASE_SERVICE_ROLE_KEY
  STAGING_SUPABASE_URL or STAGING_NEXT_PUBLIC_SUPABASE_URL
  STAGING_SUPABASE_SERVICE_ROLE_KEY

Required for --user:
  PROD_SOURCE_USER_ID
  STAGING_TARGET_USER_ID

Safety:
  Without --apply this only prints a dry-run summary.
  The target URL must be the configured staging Supabase project.
`);
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function hasArg(name) {
  return process.argv.slice(2).includes(name);
}

function env(name, aliases = []) {
  for (const key of [name, ...aliases]) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

function requiredEnv(name, aliases = []) {
  const value = env(name, aliases);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeSupabaseUrl(value, label) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
}

function projectRef(url) {
  return new URL(url).hostname.split(".")[0] ?? "";
}

function createSupabase(name, url, key) {
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        "X-Client-Info": `tierlog-staging-sync/${name}`,
      },
    },
  });
}

function buildKey(row, columns) {
  return JSON.stringify(columns.map((column) => row[column] ?? null));
}

function stripColumns(row, columns) {
  const next = { ...row };
  for (const column of columns) {
    delete next[column];
  }
  return next;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function selectAll(client, table, applyFilters = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = client.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    query = applyFilters(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function selectInChunks(client, table, column, values) {
  if (values.length === 0) return [];
  const rows = [];
  for (const valueChunk of chunk(values, DELETE_BATCH_SIZE)) {
    rows.push(...await selectAll(client, table, (query) => query.in(column, valueChunk)));
  }
  return rows;
}

async function insertRows(client, table, rows) {
  for (const rowChunk of chunk(rows, WRITE_BATCH_SIZE)) {
    const { error } = await client.from(table).insert(rowChunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

async function upsertRows(client, table, rows, keyColumns) {
  for (const rowChunk of chunk(rows, WRITE_BATCH_SIZE)) {
    const { error } = await client
      .from(table)
      .upsert(rowChunk, { onConflict: keyColumns.join(",") });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

async function deleteByFilter(client, table, applyFilters) {
  const { error } = await applyFilters(client.from(table).delete());
  if (error) throw new Error(`${table} delete failed: ${error.message}`);
}

async function deleteByValues(client, table, column, values) {
  for (const valueChunk of chunk(values, DELETE_BATCH_SIZE)) {
    await deleteByFilter(client, table, (query) => query.in(column, valueChunk));
  }
}

async function deleteByCompositeKey(client, table, keyColumns, rows) {
  for (const row of rows) {
    await deleteByFilter(client, table, (query) => {
      let next = query;
      for (const column of keyColumns) {
        next = next.eq(column, row[column]);
      }
      return next;
    });
  }
}

async function syncGlobalTable({ source, target, spec, dryRun }) {
  const sourceRows = await selectAll(source, spec.table);
  const targetRows = await selectAll(target, spec.table);
  const sourceKeys = new Set(sourceRows.map((row) => buildKey(row, spec.keyColumns)));
  const extraRows = targetRows.filter((row) => !sourceKeys.has(buildKey(row, spec.keyColumns)));
  const upsertPayload = sourceRows.map((row) => stripColumns(row, spec.stripColumns));

  console.log(
    [
      `global ${spec.table}:`,
      `${sourceRows.length} source rows`,
      `${targetRows.length} current staging rows`,
      `${extraRows.length} staging-only rows to delete`,
    ].join(" ")
  );

  if (dryRun) return;

  if (upsertPayload.length > 0) {
    await upsertRows(target, spec.table, upsertPayload, spec.keyColumns);
  }

  if (extraRows.length === 0) return;
  if (spec.deleteColumn) {
    await deleteByValues(
      target,
      spec.table,
      spec.deleteColumn,
      extraRows.map((row) => row[spec.deleteColumn]).filter(Boolean)
    );
  } else {
    await deleteByCompositeKey(target, spec.table, spec.keyColumns, extraRows);
  }
}

async function syncGlobals({ source, target, dryRun }) {
  console.log("\n== Global master data ==");
  for (const spec of GLOBAL_TABLES) {
    await syncGlobalTable({ source, target, spec, dryRun });
  }
}

async function getProfile(client, userId, label) {
  const { data, error } = await client
    .from("profiles")
    .select("id, display_name, is_admin, is_guest, stage")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`${label} profile lookup failed: ${error.message}`);
  return data;
}

async function syncUserData({ source, target, sourceUserId, targetUserId, dryRun }) {
  console.log("\n== Specific user battle data ==");

  const sourceProfile = await getProfile(source, sourceUserId, "source");
  if (!sourceProfile) {
    throw new Error(`Source profile not found: ${sourceUserId}`);
  }

  const targetProfile = await getProfile(target, targetUserId, "target");
  if (!targetProfile) {
    throw new Error(
      `Target staging profile not found: ${targetUserId}. Log in to staging once before copying data.`
    );
  }

  const sourceDecks = await selectAll(source, "decks", (query) => query.eq("user_id", sourceUserId));
  const sourceDeckIds = sourceDecks.map((deck) => deck.id);
  const sourceTunings = await selectInChunks(source, "deck_tunings", "deck_id", sourceDeckIds);
  const sourceBattles = await selectAll(source, "battles", (query) => query.eq("user_id", sourceUserId));

  const targetDecks = await selectAll(target, "decks", (query) => query.eq("user_id", targetUserId));
  const targetDeckIds = targetDecks.map((deck) => deck.id);
  const targetTunings = await selectInChunks(target, "deck_tunings", "deck_id", targetDeckIds);
  const targetBattles = await selectAll(target, "battles", (query) => query.eq("user_id", targetUserId));

  console.log(`source profile: ${sourceProfile.display_name ?? "(no name)"} ${sourceUserId}`);
  console.log(`target profile: ${targetProfile.display_name ?? "(no name)"} ${targetUserId}`);
  console.log(`source decks: ${sourceDecks.length}`);
  console.log(`source deck_tunings: ${sourceTunings.length}`);
  console.log(`source battles: ${sourceBattles.length}`);
  console.log(`current staging decks to replace: ${targetDecks.length}`);
  console.log(`current staging deck_tunings to replace: ${targetTunings.length}`);
  console.log(`current staging battles to replace: ${targetBattles.length}`);

  if (dryRun) return;

  const deckIdMap = new Map(sourceDecks.map((deck) => [deck.id, randomUUID()]));
  const tuningIdMap = new Map(sourceTunings.map((tuning) => [tuning.id, randomUUID()]));
  const battleIdMap = new Map(sourceBattles.map((battle) => [battle.id, randomUUID()]));

  const deckPayload = sourceDecks.map((deck) => ({
    ...deck,
    id: deckIdMap.get(deck.id),
    user_id: targetUserId,
  }));
  const tuningPayload = sourceTunings.map((tuning) => {
    const mappedDeckId = deckIdMap.get(tuning.deck_id);
    if (!mappedDeckId) {
      throw new Error(`Missing mapped deck for tuning ${tuning.id}`);
    }
    return {
      ...tuning,
      id: tuningIdMap.get(tuning.id),
      deck_id: mappedDeckId,
    };
  });
  const battlePayload = sourceBattles.map((battle) => {
    const mappedDeckId = deckIdMap.get(battle.my_deck_id);
    if (!mappedDeckId) {
      throw new Error(`Missing mapped deck for battle ${battle.id}`);
    }
    const mappedTuningId = battle.tuning_id ? tuningIdMap.get(battle.tuning_id) : null;
    if (battle.tuning_id && !mappedTuningId) {
      throw new Error(`Missing mapped tuning for battle ${battle.id}`);
    }
    return {
      ...battle,
      id: battleIdMap.get(battle.id),
      user_id: targetUserId,
      my_deck_id: mappedDeckId,
      tuning_id: mappedTuningId,
    };
  });

  await deleteByFilter(target, "battles", (query) => query.eq("user_id", targetUserId));
  await deleteByValues(target, "deck_tunings", "deck_id", targetDeckIds);
  await deleteByFilter(target, "decks", (query) => query.eq("user_id", targetUserId));

  await insertRows(target, "decks", deckPayload);
  await insertRows(target, "deck_tunings", tuningPayload);
  await insertRows(target, "battles", battlePayload);

  const finalDecks = await selectAll(target, "decks", (query) => query.eq("user_id", targetUserId));
  const finalBattles = await selectAll(target, "battles", (query) => query.eq("user_id", targetUserId));
  console.log(`final staging decks: ${finalDecks.length}`);
  console.log(`final staging battles: ${finalBattles.length}`);
}

async function main() {
  if (hasArg("--help") || hasArg("-h")) {
    usage();
    return;
  }

  const syncAll = hasArg("--all");
  const syncGlobalData = syncAll || hasArg("--globals");
  const syncUser = syncAll || hasArg("--user");
  const dryRun = !hasArg("--apply");

  if (!syncGlobalData && !syncUser) {
    usage();
    process.exitCode = 1;
    return;
  }

  const prodUrl = normalizeSupabaseUrl(
    requiredEnv("PROD_SUPABASE_URL", ["PROD_NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    "PROD_SUPABASE_URL"
  );
  const stagingUrl = normalizeSupabaseUrl(
    requiredEnv("STAGING_SUPABASE_URL", ["STAGING_NEXT_PUBLIC_SUPABASE_URL"]),
    "STAGING_SUPABASE_URL"
  );
  const prodKey = requiredEnv("PROD_SUPABASE_SERVICE_ROLE_KEY", ["SUPABASE_SERVICE_ROLE_KEY"]);
  const stagingKey = requiredEnv("STAGING_SUPABASE_SERVICE_ROLE_KEY");
  const expectedStagingRef = env("EXPECTED_STAGING_PROJECT_REF") ?? DEFAULT_STAGING_REF;

  if (prodUrl === stagingUrl) {
    throw new Error("Production and staging Supabase URLs are identical. Refusing to continue.");
  }

  if (projectRef(stagingUrl) !== expectedStagingRef) {
    throw new Error(
      `Target staging project ref is ${projectRef(stagingUrl)}, expected ${expectedStagingRef}. ` +
        "Set EXPECTED_STAGING_PROJECT_REF only if the staging project intentionally changed."
    );
  }

  const sourceUserId = getArgValue("--source-user-id") ?? env("PROD_SOURCE_USER_ID");
  const targetUserId = getArgValue("--target-user-id") ?? env("STAGING_TARGET_USER_ID");

  if (syncUser && (!sourceUserId || !targetUserId)) {
    throw new Error("PROD_SOURCE_USER_ID and STAGING_TARGET_USER_ID are required for --user.");
  }

  console.log(dryRun ? "Mode: DRY RUN (no writes)" : "Mode: APPLY (writes to staging)");
  console.log(`source project: ${projectRef(prodUrl)}`);
  console.log(`target project: ${projectRef(stagingUrl)}`);

  const source = createSupabase("prod", prodUrl, prodKey);
  const target = createSupabase("staging", stagingUrl, stagingKey);

  if (syncGlobalData) {
    await syncGlobals({ source, target, dryRun });
  }

  if (syncUser) {
    await syncUserData({
      source,
      target,
      sourceUserId,
      targetUserId,
      dryRun,
    });
  }

  if (dryRun) {
    console.log("\nDry-run complete. Re-run with --apply to write to staging.");
  } else {
    console.log("\nStaging data sync complete.");
  }
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exitCode = 1;
});
