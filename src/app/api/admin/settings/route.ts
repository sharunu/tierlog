import { NextRequest, NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth/require-bearer";

// PR9 Phase 9b: app_settings 一般設定 API (admin-only)
//   GET  : 現在の share_retention_days を取得
//   POST : share_retention_days を更新 (DB の validate_app_settings trigger でも 1〜3650 を強制)
// service_role で app_settings を直接読み書きするため、必ず requireBearer({ requireAdmin: true }) で
// admin チェックを通す。

type AppSettingsRow = {
  key: string;
  value: number | string | null;
  updated_at: string | null;
};

export async function GET(request: NextRequest) {
  const auth = await requireBearer(request, { requireAdmin: true });
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabaseAdmin
    .from("app_settings")
    .select("key, value, updated_at")
    .eq("key", "share_retention_days")
    .maybeSingle<AppSettingsRow>();

  if (error) {
    return NextResponse.json(
      { error: "db_error", reason: error.message },
      { status: 500 },
    );
  }

  const days =
    typeof data?.value === "number"
      ? data.value
      : typeof data?.value === "string"
        ? Number(data.value) || null
        : null;

  return NextResponse.json({
    share_retention_days: days,
    updated_at: data?.updated_at ?? null,
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireBearer(request, { requireAdmin: true });
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const days = (body as { share_retention_days?: unknown })?.share_retention_days;
  if (
    typeof days !== "number" ||
    !Number.isInteger(days) ||
    days < 1 ||
    days > 3650
  ) {
    return NextResponse.json(
      {
        error: "invalid_value",
        reason: "share_retention_days は 1〜3650 の整数で指定してください",
      },
      { status: 400 },
    );
  }

  // jsonb number として直接送信される (supabase-js は number を JSON number にシリアライズ)。
  // updated_at / updated_by はテーブル側で自動更新する trigger を作っていないので明示セット。
  const { error } = await auth.supabaseAdmin
    .from("app_settings")
    .update({
      value: days,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("key", "share_retention_days");

  if (error) {
    return NextResponse.json(
      { error: "db_error", reason: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, share_retention_days: days });
}
