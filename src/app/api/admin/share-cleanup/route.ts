import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireBearer } from "@/lib/auth/require-bearer";

// PR9 Phase 9b: 期限切れ share の手動削除 API (admin-only)
//   GET  : list_expired_shares() の件数を返す (preview)
//   POST : Storage 画像削除 + shares 行削除を実行
//
// 公開初期方針 (Resolved Decision [PR9 retention]): 自動 cron は持たず、
// admin の一般設定画面から手動ボタンで実行する。

const STORAGE_PATH_MARKER = "/storage/v1/object/public/share-images/";

type ExpiredShareRow = {
  id: string;
  user_id: string | null;
  image_path: string | null;
  image_url: string | null;
};

function deriveStoragePath(row: ExpiredShareRow): string | null {
  if (row.image_path && row.image_path.trim() !== "" && row.image_path !== "/") {
    return row.image_path;
  }
  if (row.image_url && row.image_url.includes(STORAGE_PATH_MARKER)) {
    const parts = row.image_url.split(STORAGE_PATH_MARKER);
    const path = parts[1];
    if (path && path.trim() !== "" && path !== "/") return path;
  }
  return null;
}

async function fetchExpired(
  supabaseAdmin: SupabaseClient,
): Promise<{ rows: ExpiredShareRow[]; error: string | null }> {
  const { data, error } = await supabaseAdmin.rpc("list_expired_shares");
  if (error) return { rows: [], error: error.message };
  return { rows: (data as ExpiredShareRow[] | null) ?? [], error: null };
}

export async function GET(request: NextRequest) {
  const auth = await requireBearer(request, { requireAdmin: true });
  if (!auth.ok) return auth.response;

  const { rows, error } = await fetchExpired(auth.supabaseAdmin);
  if (error) {
    return NextResponse.json({ error: "db_error", reason: error }, { status: 500 });
  }

  const withPath = rows.filter((r) => deriveStoragePath(r) !== null).length;
  return NextResponse.json({
    count: rows.length,
    storage_targets: withPath,
    orphan_rows: rows.length - withPath,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireBearer(request, { requireAdmin: true });
  if (!auth.ok) return auth.response;

  const { rows, error } = await fetchExpired(auth.supabaseAdmin);
  if (error) {
    return NextResponse.json({ error: "db_error", reason: error }, { status: 500 });
  }

  if (rows.length === 0) {
    return NextResponse.json({
      ok: true,
      deleted: 0,
      storage_deleted: 0,
      storage_warnings: [],
    });
  }

  // Storage 削除 (image_path 優先、URL fallback)
  const storagePaths: string[] = [];
  for (const row of rows) {
    const p = deriveStoragePath(row);
    if (p !== null) storagePaths.push(p);
  }

  let storageDeleted = 0;
  const storageWarnings: string[] = [];
  if (storagePaths.length > 0) {
    const { data: removed, error: removeError } = await auth.supabaseAdmin.storage
      .from("share-images")
      .remove(storagePaths);

    if (removeError) {
      // Storage 削除でハードエラー (auth/network) → DB 行は残して再試行可能にする
      return NextResponse.json(
        {
          error: "storage_error",
          reason: removeError.message,
          attempted_paths: storagePaths.length,
        },
        { status: 500 },
      );
    }

    storageDeleted = removed?.length ?? 0;
    if (storageDeleted < storagePaths.length) {
      // ファイル不在等で個別失敗があった場合の参考情報 (致命ではないので継続)
      storageWarnings.push(
        `expected ${storagePaths.length} files removed, got ${storageDeleted}`,
      );
    }
  }

  // shares 行を削除 (Storage 失敗していない場合のみここに到達)
  const ids = rows.map((r) => r.id);
  const { error: deleteError } = await auth.supabaseAdmin
    .from("shares")
    .delete()
    .in("id", ids);

  if (deleteError) {
    return NextResponse.json(
      {
        error: "db_error",
        reason: deleteError.message,
        storage_deleted: storageDeleted,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    deleted: ids.length,
    storage_deleted: storageDeleted,
    storage_warnings: storageWarnings,
  });
}
