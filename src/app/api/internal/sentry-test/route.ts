// Sentry 動作検証用の管理者専用 endpoint (Phase 4 一時 endpoint)
//
// 用途:
// Custom Worker (src/sentry-worker.ts) の Sentry.withSentry は worker handler
// レベルの wrap だが、Next.js が API route handler の throw を catch して 500
// Response に変換するため、Worker レベルでは unhandled exception にならず、
// withSentry の自動捕捉が効かないと判明 (Phase 4 検証 1 回目で確認済)。
//
// よって明示的に Sentry.captureException + Sentry.flush で送出する。これは
// Sentry 公式 (https://docs.sentry.io/platforms/javascript/guides/cloudflare/
// usage/) の推奨パターンで、Cloudflare Workers の短命な lifecycle で SDK が
// イベントを送り終える前に worker が exit するのを防ぐため flush が必須。
//
// 安全条件 (plan §4-4 #6-b):
// - INTERNAL_API_KEY (X-Internal-Key header) で保護
// - 同一 PR 内 (dev branch 内) で「追加 commit → 検証 → 削除 commit」を完結
// - main には絶対に流さない
// - 公開ユーザーが叩けない導線に限定
//
// 検証完了後、本ファイルを削除する commit を push して #6-b Phase 4 を閉じる。

import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/cloudflare";
import { getServerEnv } from "@/lib/cf-env";

export async function GET(request: NextRequest) {
  const internalKey = request.headers.get("X-Internal-Key");
  const expectedKey = await getServerEnv("INTERNAL_API_KEY");

  if (!expectedKey || internalKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const error = new Error(
    "Sentry test throw from /api/internal/sentry-test (manual verification, 2026-05-25)"
  );

  // 明示的に Sentry に送出し、flush で送信完了を待ってから throw する。
  // Cloudflare Workers では request lifecycle が短いため、flush なしだと
  // イベント送信が完了する前に worker が exit してイベントが Sentry に届かない。
  Sentry.captureException(error);
  await Sentry.flush(2000);

  throw error;
}
