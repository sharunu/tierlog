import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GAME, isGameSlug } from "@/lib/games";

import { requireBearer } from "@/lib/auth/require-bearer";
import { getServerEnv } from "@/lib/cf-env";

export async function POST(request: NextRequest) {
  try {
    let bodyGame: string | undefined;
    try {
      const body = await request.json();
      bodyGame = typeof body?.game === "string" ? body.game : undefined;
    } catch {
      bodyGame = undefined;
    }
    const game = isGameSlug(bodyGame) ? bodyGame : DEFAULT_GAME;

    // Plan D / D-4: requireBearer 経由に統一 (account_access_state チェック含む)。
    const auth = await requireBearer(request);
    if (!auth.ok) return auth.response;

    // Get discord connection with token info
    const { data: conn } = await auth.supabaseAdmin
      .from("discord_connections")
      .select("discord_username, access_token, refresh_token, token_expires_at")
      .eq("user_id", auth.userId)
      .eq("game_title", game)
      .maybeSingle();

    if (!conn) {
      return NextResponse.json({ error: "no discord connection" }, { status: 404 });
    }

    let accessToken = conn.access_token;

    // Check if token is expired and refresh if needed
    if (conn.token_expires_at && new Date(conn.token_expires_at) < new Date()) {
      if (!conn.refresh_token) {
        return NextResponse.json({ error: "token expired, no refresh token" }, { status: 401 });
      }

      const refreshRes = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ?? "",
          client_secret: (await getServerEnv("DISCORD_CLIENT_SECRET")) ?? "",
          grant_type: "refresh_token",
          refresh_token: conn.refresh_token,
        }),
      });

      if (!refreshRes.ok) {
        console.error("Discord token refresh failed:", await refreshRes.text());
        return NextResponse.json({ error: "token refresh failed" }, { status: 502 });
      }

      const tokens = await refreshRes.json();
      accessToken = tokens.access_token;
      const newRefreshToken = tokens.refresh_token ?? conn.refresh_token;
      const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

      // Update tokens in discord_connections (game_title 絞りがないと複数ゲーム連携時に他ゲームの token を上書きしてしまう)
      await auth.supabaseAdmin
        .from("discord_connections")
        .update({
          access_token: accessToken,
          refresh_token: newRefreshToken,
          token_expires_at: tokenExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", auth.userId)
        .eq("game_title", game);
    }

    // Fetch Discord user info to update username
    let discordUsername = conn.discord_username;
    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (userRes.ok) {
      const discordUser = await userRes.json();
      discordUsername = discordUser.global_name ?? discordUser.username;

      if (discordUsername !== conn.discord_username) {
        await auth.supabaseAdmin
          .from("discord_connections")
          .update({ discord_username: discordUsername, updated_at: new Date().toISOString() })
          .eq("user_id", auth.userId)
          .eq("game_title", game);
      }
    }

    // Fetch guilds from Discord
    const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!guildsRes.ok) {
      return NextResponse.json({ error: "discord api error" }, { status: 502 });
    }

    const guilds = await guildsRes.json();
    const guildData = (guilds as { id: string; name: string; icon: string | null }[]).map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
    }));

    // Sync
    const { error: syncError } = await auth.supabaseAdmin.rpc("sync_team_membership", {
      p_user_id: auth.userId,
      p_discord_username: discordUsername,
      p_guilds: guildData,
      p_game_title: game,
    });

    if (syncError) {
      console.error("sync error:", syncError);
      return NextResponse.json({ error: "sync failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, guildCount: guildData.length });
  } catch (err) {
    console.error("refresh-guilds error:", err);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
