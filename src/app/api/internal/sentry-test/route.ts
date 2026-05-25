// Sentry 動作検証用の管理者専用 endpoint (Phase 4 一時 endpoint)
//
// 用途:
// Custom Worker (src/sentry-worker.ts) の Sentry.withSentry が、server-side
// で発生した exception を Sentry に送出できるかを確認する。
//
// 安全条件 (plan §4-4 #6-b):
// - INTERNAL_API_KEY (X-Internal-Key header) で保護
// - 同一 PR 内 (dev branch 内) で「追加 commit → 検証 → 削除 commit」を完結
// - main には絶対に流さない (削除済の差分のみ main に流す)
// - 公開ユーザーが叩けない導線に限定
//
// 検証完了後、本ファイルを削除する commit を push して #6-b Phase 4 を閉じる。

import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/cf-env";

export async function GET(request: NextRequest) {
  const internalKey = request.headers.get("X-Internal-Key");
  const expectedKey = await getServerEnv("INTERNAL_API_KEY");

  if (!expectedKey || internalKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 意図的な throw。Sentry Custom Worker が捕捉することを検証する。
  throw new Error("Sentry test throw from /api/internal/sentry-test (manual verification, 2026-05-25)");
}
