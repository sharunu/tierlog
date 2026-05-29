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
      // Plan D (Codex review 2 P1): D-1 migration が未適用の DB で新コードが動いた場合、
      // RPC は PGRST202 (function does not exist) を返す。production 反映フローは
      // 「D-1 を additive expand として code deploy 前に先行適用」を想定 (runbook §7 参照)
      // だが、順序事故時の安全網として function 未存在エラーだけは active fallback で素通す。
      // それ以外のエラー (network / permission / 内部例外) は本来通り 403 で拒否する。
      if (isMissingFunctionError(accessStateError)) {
        console.warn(
          "account_access_state RPC missing (D-1 未適用?) — temporary active fallback",
          { code: accessStateError.code, message: accessStateError.message },
        );
        // fallback して return せず、関数末尾の return ok: true に流す
      } else {
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
    } else if (accessState !== "active") {
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

// Plan D (Codex review 2 P1): PostgREST が function を見つけられない時の error を判定。
// supabase-js の PostgrestError.code は PGRST202 ("Could not find the function ... in the schema cache")
// または P0001 / 42883 系。message ベース判定で複数経路をカバーする。
// shape は { code?: string; message?: string; details?: string; hint?: string }
export function isMissingFunctionError(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  if (error?.code === "PGRST202") return true;
  const msg = error?.message ?? "";
  if (!msg) return false;
  // PostgREST schema cache miss / Postgres function-does-not-exist の両方をカバー
  if (msg.includes("Could not find the function")) return true;
  if (msg.includes("schema cache")) return true;
  if (msg.includes("function") && msg.includes("does not exist")) return true;
  return false;
}
