import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/cf-env";
import type { Database } from "@/lib/supabase/database.types";

// admin API route (PR9 Phase 9b 以降) で session cookie 経由ではなく
// Authorization: Bearer <access_token> ヘッダを受け取り、service_role で getUser 検証する
// 共通ヘルパ。既存 /api/admin/limitless-sync の auth 処理を抽象化したもの。
//
// Plan D / D-4: requireActiveUser (デフォルト true) を追加。
// account_access_state(p_uid) RPC を call し、'active' 以外なら 403。
// /api/account/delete だけ requireActiveUser: false で opt-out (RD-D4-1、退会の自由保証)。
// admin は account_access_state の admin 例外 (RD-D3-1) で 'active' が返るため、
// requireAdmin と requireActiveUser を同時指定しても admin は素通る。
export type BearerAuthResult =
  | { ok: true; userId: string; supabaseAdmin: SupabaseClient<Database> }
  | { ok: false; response: NextResponse };

export async function requireBearer(
  request: NextRequest,
  options: { requireAdmin?: boolean; requireActiveUser?: boolean } = {},
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

  const supabaseAdmin = createClient<Database>(supabaseUrl, serviceRoleKey, {
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

  // Plan D / D-4: account_access_state チェック (デフォルト true)。
  // admin は account_access_state 内の RD-D3-1 例外で 'active' が返るので素通る。
  if (options.requireActiveUser ?? true) {
    const { data: accessState, error: accessStateError } = await supabaseAdmin.rpc(
      "account_access_state",
      { p_uid: user.id },
    );
    if (accessStateError) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: "Forbidden",
            reason: `account_access_state_error:${accessStateError.message}`,
          },
          { status: 403 },
        ),
      };
    }
    if (accessState !== "active") {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Forbidden", reason: `account_not_active:${accessState ?? "unknown"}` },
          { status: 403 },
        ),
      };
    }
  }

  return { ok: true, userId: user.id, supabaseAdmin };
}
