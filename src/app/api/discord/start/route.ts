import { NextRequest, NextResponse } from "next/server";
import { isGameSlug } from "@/lib/games";

import { requireBearer } from "@/lib/auth/require-bearer";

export async function POST(request: NextRequest) {
  try {
    // 1. body の game 検証
    let bodyGame: unknown;
    try {
      const body = await request.json();
      bodyGame = (body as { game?: unknown })?.game;
    } catch {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    if (typeof bodyGame !== "string" || !isGameSlug(bodyGame)) {
      return NextResponse.json({ error: "invalid game" }, { status: 400 });
    }
    const game = bodyGame;

    // 2. Plan D / D-4: requireBearer 経由に統一 (account_access_state チェック含む)。
    // 手動 Bearer 検証から requireBearer へ寄せる。
    const auth = await requireBearer(request);
    if (!auth.ok) return auth.response;

    // 3. opportunistic cleanup（期限切れ nonce を削除）
    await auth.supabaseAdmin
      .from("discord_oauth_states")
      .delete()
      .lt("expires_at", new Date().toISOString());

    // 4. nonce 生成 + INSERT
    const { data: inserted, error: insertError } = await auth.supabaseAdmin
      .from("discord_oauth_states")
      .insert({ user_id: auth.userId, game_title: game })
      .select("nonce")
      .single();

    if (insertError || !inserted) {
      console.error("discord_oauth_states insert error:", insertError);
      return NextResponse.json({ error: "state creation failed" }, { status: 500 });
    }

    // 5. origin はリクエスト由来（NEXT_PUBLIC_APP_URL は本番固定のため preview で事故る）。
    // callback の redirect_uri と完全一致させるため、両 route で同じ算出（new URL(request.url).origin）を使う
    const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({ error: "discord client id not configured" }, { status: 500 });
    }
    const origin = new URL(request.url).origin;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${origin}/api/discord/callback`,
      response_type: "code",
      scope: "identify guilds",
      state: inserted.nonce,
    });

    const authorizeUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;
    return NextResponse.json({ authorizeUrl });
  } catch (err) {
    console.error("discord/start error:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
