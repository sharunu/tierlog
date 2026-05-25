// Sentry 動作検証用の管理者専用 endpoint (Phase 4 一時 endpoint)
//
// 用途:
// Phase 4 検証 2 回目の結果、Sentry.captureException + flush でも Sentry Dashboard に
// イベントが届かないことが確認された。原因を切り分けるため、throw を一旦やめて
// Sentry SDK の状態を JSON で返す診断モードに変更する。
//
// 確認したい論点:
// 1. env.SENTRY_DSN が Custom Worker 経由で Next.js handler に届いているか
//    (Cloudflare Runtime variable → src/sentry-worker.ts → .open-next/worker.js → Next.js handler の経路)
// 2. Sentry.getClient() が hub を返すか
//    (withSentry の context が AsyncLocalStorage 経由で Next.js handler 内まで伝播しているか)
// 3. captureException の戻り値 (event_id) が取得できるか
// 4. flush の戻り値 (true/false) で送信完了状況がわかるか
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

interface SentryDiagnostics {
  timestamp: string;
  runtime: "node-compat" | "edge" | "unknown";
  has_sentry_dsn_env: boolean;
  sentry_dsn_prefix: string | null;
  has_sentry_client: boolean;
  sentry_client_dsn_host: string | null;
  captured_event_id: string | null;
  flush_result: boolean | "no_client";
}

export async function GET(request: NextRequest) {
  const internalKey = request.headers.get("X-Internal-Key");
  const expectedKey = await getServerEnv("INTERNAL_API_KEY");

  if (!expectedKey || internalKey !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. SENTRY_DSN が Next.js handler から見えるか (getServerEnv 経由)
  const sentryDsn = await getServerEnv("SENTRY_DSN");

  // 2. Sentry hub が確立されているか (withSentry の context 伝播確認)
  const client = Sentry.getClient();
  const clientDsn = client?.getDsn?.();

  // 3-4. captureException + flush の戻り値で動作を確認
  let capturedEventId: string | null = null;
  let flushResult: boolean | "no_client" = "no_client";
  if (client) {
    const error = new Error("Sentry diagnostic test 2026-05-25 (no throw, JSON return)");
    const eventId = Sentry.captureException(error);
    capturedEventId = typeof eventId === "string" ? eventId : null;
    flushResult = await Sentry.flush(3000);
  }

  const diagnostics: SentryDiagnostics = {
    timestamp: new Date().toISOString(),
    runtime:
      typeof process !== "undefined" && process.env?.NEXT_RUNTIME === "edge"
        ? "edge"
        : typeof process !== "undefined"
        ? "node-compat"
        : "unknown",
    has_sentry_dsn_env: !!sentryDsn,
    sentry_dsn_prefix: sentryDsn ? sentryDsn.slice(0, 12) + "...(masked)" : null,
    has_sentry_client: !!client,
    sentry_client_dsn_host: clientDsn?.host ?? null,
    captured_event_id: capturedEventId,
    flush_result: flushResult,
  };

  return NextResponse.json(diagnostics);
}
