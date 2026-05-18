import { NextRequest, NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth/require-bearer";

// PR10 Phase A: 本人によるアカウント削除 API
//
// 削除順序 (ユーザー指定 + 2026-05-18 修正):
//   1. Bearer JWT で本人検証 (admin チェックなし)
//   2. shares.image_path / image_url から Storage path を収集
//   3. share-images/<user_id>/ 配下の実ファイルも列挙して削除候補に追加
//   4. Storage path を remove (失敗時は 500 で abort、shares/auth.users は残るのでリトライ可能)
//   5. shares 行を user_id 条件で明示 DELETE
//      (Phase B 完了までは FK が SET NULL なので明示 DELETE 必須。完了後は CASCADE の defense-in-depth)
//   6. auth.admin.deleteUser(user.id) を実行
//   7. deleteUser 失敗時は ok: true を返さず 500 (shares/Storage は既に消えているが auth.users は残るので
//      リトライ時に再度 deleteUser だけが実行され、最終的に整合する)
//
// shares.user_id FK は ON DELETE SET NULL なので deleteUser では消えない (Phase B 完了までは)。
// Storage 上の画像は public bucket のため直 URL でもアクセス可能であり、行と画像の両方を
// 確実に削除する必要がある。順序は「Storage → shares DELETE → deleteUser」で、deleteUser
// より前で失敗した場合はリトライで前進可能、deleteUser 後の失敗は警告扱い (元設計踏襲)。

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

  // === 3. Storage 上のファイルを先に削除 ===
  // shares 行 DELETE / deleteUser よりも前に Storage cleanup を試みる。理由:
  // 旧設計のように deleteUser 後の Storage remove だと、Storage 失敗時に
  // 「DB は消えたが画像は残る」状態になり、shares 行も既に消えているため list_expired_shares
  // で後から回収できない。順序を逆にすれば、Storage 失敗時は shares 行も auth.users も
  // 残るのでリトライで paths を再収集できる。
  const paths = Array.from(pathsToDelete);
  let storageDeleted = 0;
  const storageWarnings: string[] = [];
  if (paths.length > 0) {
    const { data: removed, error: removeError } = await auth.supabaseAdmin.storage
      .from(STORAGE_BUCKET)
      .remove(paths);
    if (removeError) {
      return NextResponse.json(
        {
          error: "storage_error",
          reason: `remove failed: ${removeError.message}`,
          attempted_paths: paths.length,
        },
        { status: 500 },
      );
    }
    storageDeleted = removed?.length ?? 0;
    if (storageDeleted < paths.length) {
      storageWarnings.push(
        `expected ${paths.length} files removed, got ${storageDeleted}`,
      );
    }
  }

  // === 4. shares 行を明示削除 ===
  // shares.user_id FK は ON DELETE SET NULL なので deleteUser では消えない (Phase B 完了までは)。
  // share_data は /share/[id] と /api/og/[id] から service_role で公開され続けるため、
  // アカウント削除時に行も削除しないとプライバシー保護にならない。
  // (Phase B 完了後は deleteUser の CASCADE で同じ shares を no-op で再削除する形になる)
  const { error: sharesDeleteError } = await auth.supabaseAdmin
    .from("shares")
    .delete()
    .eq("user_id", userId);
  if (sharesDeleteError) {
    return NextResponse.json(
      {
        error: "db_error",
        reason: `shares delete failed: ${sharesDeleteError.message}`,
      },
      { status: 500 },
    );
  }

  // === 5. auth.admin.deleteUser を実行 ===
  // (CASCADE: auth.users → profiles → decks / battles / discord_connections / 等)
  // ※ shares は上記 4 の明示 DELETE で先に削除済。Phase B 完了後は CASCADE が二重保険として効く
  const { error: deleteError } = await auth.supabaseAdmin.auth.admin.deleteUser(
    userId,
  );

  if (deleteError) {
    // deleteUser 失敗 → 500、shares と Storage は既に消えているが auth.users は残る。
    // リトライ時は paths が空 (Storage は no-op)、shares DELETE も冪等 (空集合)、
    // deleteUser のみが再実行され最終的に整合する。
    return NextResponse.json(
      { error: "delete_user_error", reason: deleteError.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    storage_deleted: storageDeleted,
    storage_warnings: storageWarnings,
  });
}
