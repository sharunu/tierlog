import { NextRequest, NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth/require-bearer";

// PR10 Phase A: 本人によるアカウント削除 API
//
// 削除順序 (ユーザー指定):
//   1. Bearer JWT で本人検証 (admin チェックなし)
//   2. deleteUser の前に削除対象 user の shares.image_path / image_url から Storage path を収集
//   3. 併せて share-images/<user_id>/ 配下の実ファイルも列挙して削除候補に追加
//   4. auth.admin.deleteUser(user.id) を実行
//   5. deleteUser 失敗時は Storage 削除を行わず 500 を返す (リトライ可能にする)
//   6. deleteUser 成功時のみ Storage を削除する
//      (Storage 削除失敗時は user は既に消えているため、警告として返し ok: true)
//
// shares 行は deleteUser 後の CASCADE で消える可能性があるため、必ず deleteUser 前に
// 必要情報を読み取っておく (deleteUser 後に DB から拾う設計にはしない)。

const STORAGE_PATH_MARKER = "/storage/v1/object/public/share-images/";
const STORAGE_BUCKET = "share-images";

function deriveStoragePath(row: {
  image_path: string | null;
  image_url: string | null;
}): string | null {
  if (row.image_path && row.image_path.trim() !== "" && row.image_path !== "/") {
    return row.image_path;
  }
  if (row.image_url && row.image_url.includes(STORAGE_PATH_MARKER)) {
    const path = row.image_url.split(STORAGE_PATH_MARKER)[1];
    if (path && path.trim() !== "" && path !== "/") return path;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const auth = await requireBearer(request);
  if (!auth.ok) return auth.response;

  const userId = auth.userId;
  const pathsToDelete = new Set<string>();

  // === 1. shares.image_path / image_url から Storage path を収集 ===
  const { data: sharesData, error: sharesError } = await auth.supabaseAdmin
    .from("shares")
    .select("image_path, image_url")
    .eq("user_id", userId);

  if (sharesError) {
    return NextResponse.json(
      { error: "db_error", reason: `shares select failed: ${sharesError.message}` },
      { status: 500 },
    );
  }

  const sharesRows = (sharesData ?? []) as Array<{
    image_path: string | null;
    image_url: string | null;
  }>;
  for (const row of sharesRows) {
    const p = deriveStoragePath(row);
    if (p) pathsToDelete.add(p);
  }

  // === 2. share-images/<userId>/ 配下を列挙 (orphan ファイル対応) ===
  // 1 回の list で最大 1000 件まで取得。それ以上ある場合は offset でページング。
  // list 失敗時は deleteUser 前なので 500 で abort → ユーザー再試行可能。
  const pageSize = 1000;
  let offset = 0;
  for (;;) {
    const { data: files, error: listError } = await auth.supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .list(userId, { limit: pageSize, offset });
    if (listError) {
      return NextResponse.json(
        {
          error: "storage_error",
          reason: `list failed: ${listError.message}`,
        },
        { status: 500 },
      );
    }
    if (!files || files.length === 0) break;
    for (const f of files) {
      if (f.name && !f.name.endsWith("/")) {
        pathsToDelete.add(`${userId}/${f.name}`);
      }
    }
    if (files.length < pageSize) break;
    offset += pageSize;
  }

  // === 3. auth.admin.deleteUser を実行 ===
  // (CASCADE: auth.users → profiles → shares / decks / battles / discord_connections / 等)
  const { error: deleteError } = await auth.supabaseAdmin.auth.admin.deleteUser(
    userId,
  );

  if (deleteError) {
    // deleteUser 失敗 → Storage は触らず 500
    return NextResponse.json(
      { error: "delete_user_error", reason: deleteError.message },
      { status: 500 },
    );
  }

  // === 4. deleteUser 成功 → Storage 削除 ===
  // ここで Storage が失敗してもユーザーは既に消えているので、警告として返し ok:true で応答する。
  // (orphan ファイルが残るが PR9 の expires_at による cleanup や手動 cleanup で回収可能)
  const paths = Array.from(pathsToDelete);
  let storageDeleted = 0;
  const storageWarnings: string[] = [];

  if (paths.length > 0) {
    const { data: removed, error: removeError } = await auth.supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove(paths);
    if (removeError) {
      storageWarnings.push(`storage remove error: ${removeError.message}`);
    } else {
      storageDeleted = removed?.length ?? 0;
      if (storageDeleted < paths.length) {
        storageWarnings.push(
          `expected ${paths.length} files removed, got ${storageDeleted}`,
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    storage_deleted: storageDeleted,
    storage_warnings: storageWarnings,
  });
}
