import { NextRequest, NextResponse } from "next/server";

import { requireBearer } from "@/lib/auth/require-bearer";
import { runLimitlessSync } from "@/lib/pokepoke/limitless-sync";

export async function POST(request: NextRequest) {
  // Plan D / D-4: 手動 Bearer 検証を requireBearer + requireAdmin に統一。
  // admin は account_access_state の admin 例外 (RD-D3-1) で 'active' 相当扱いされるため、
  // requireActiveUser のデフォルト true でも admin は素通る。
  const auth = await requireBearer(request, { requireAdmin: true });
  if (!auth.ok) return auth.response;

  const result = await runLimitlessSync({ force: false });
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }
  return NextResponse.json(result);
}
