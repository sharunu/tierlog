import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/cf-env";

// admin API route (PR9 Phase 9b 以降) で session cookie 経由ではなく
// Authorization: Bearer <access_token> ヘッダを受け取り、service_role で getUser 検証する
// 共通ヘルパ。既存 /api/admin/limitless-sync の auth 処理を抽象化したもの。
export type BearerAuthResult =
  | { ok: true; userId: string; supabaseAdmin: SupabaseClient }
  | { ok: false; response: NextResponse };

export async function requireBearer(
  request: NextRequest,
  options: { requireAdmin?: boolean } = {},
): Promise<BearerAuthResult> {
  const authHeader = request.headers.get("authorization");
  const jwt = authHeader?.replace("Bearer ", "");
  if (!jwt) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized", reason: "no_bearer" },
        { status: 401 },
      ),
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = await getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Server configuration error", reason: "missing_env" },
        { status: 500 },
      ),
    };
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(jwt);
  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized", reason: "invalid_jwt" },
        { status: 401 },
      ),
    };
  }

  if (options.requireAdmin) {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (profileError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Forbidden", reason: `profile_error:${profileError.message}` },
          { status: 403 },
        ),
      };
    }
    if (!profile?.is_admin) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Forbidden", reason: "not_admin" },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, userId: user.id, supabaseAdmin };
}
