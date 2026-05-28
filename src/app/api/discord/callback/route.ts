import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DEFAULT_GAME, isGameSlug, type GameSlug } from "@/lib/games";

import { getServerEnv } from "@/lib/cf-env";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const reqUrl = new URL(request.url);
  const code = reqUrl.searchParams.get("code");
  const state = reqUrl.searchParams.get("state");

  // origin は start route と完全一致させる（new URL(request.url).origin）。
  // 不一致だと Discord token exchange の redirect_uri 検証で失敗する
  const origin = reqUrl.origin;

  if (!code || !state) {
    return NextResponse.redirect(new URL("/home?discord=error", origin));
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (await getServerEnv("SUPABASE_SERVICE_ROLE_KEY"))!,
  );

  // state は UUID nonce のみ受け付ける (discord_oauth_states に紐付く)
  if (!UUID_RE.test(state)) {
    console.error("non-uuid state rejected");
    return NextResponse.redirect(new URL(`/${DEFAULT_GAME}/home?discord=error`, origin));
  }

  // discord_oauth_states から atomic consume（DELETE ... RETURNING）
  // 同一 nonce が並列 callback に来ても片方しか成功しない
  const { data: stateRow, error: stateError } = await supabaseAdmin
    .from("discord_oauth_states")
    .delete()
    .eq("nonce", state)
    .gte("expires_at", new Date().toISOString())
    .select("user_id, game_title")
    .maybeSingle();

  if (stateError || !stateRow) {
    console.error("discord_oauth_states consume failed:", stateError);
    return NextResponse.redirect(new URL(`/${DEFAULT_GAME}/home?discord=error`, origin));
  }
  const userId: string = stateRow.user_id;
  const game: GameSlug = isGameSlug(stateRow.game_title) ? stateRow.game_title : DEFAULT_GAME;

  // Plan D / D-4: discord callback は Bearer を持たない (OAuth state 経由) ため
  // inline で stateRow.user_id に対して account_access_state を確認する。
  // requireBearer は Bearer が無いため使えない。stage=4 / banned ならここで打ち切り、
  // token upsert / sync_team_membership を呼び出さない。
  // admin 例外 (RD-D3-1) は account_access_state 関数内で担保される。
  const { data: accessState, error: accessStateError } = await supabaseAdmin.rpc(
    "account_access_state",
    { p_uid: userId },
  );
  if (accessStateError) {
    console.error("account_access_state error in discord callback:", accessStateError);
    return NextResponse.redirect(new URL(`/${game}/home?discord=error`, origin));
  }
  if (accessState !== "active") {
    console.warn(`discord callback rejected: user=${userId} state=${accessState ?? "unknown"}`);
    return NextResponse.redirect(new URL(`/${game}/home?discord=error`, origin));
  }

  try {
    // 2. Discord token 交換
    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID ?? "",
        client_secret: (await getServerEnv("DISCORD_CLIENT_SECRET")) ?? "",
        grant_type: "authorization_code",
        code,
        redirect_uri: `${origin}/api/discord/callback`,
      }),
    });

    if (!tokenRes.ok) {
      console.error("Discord token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(new URL(`/${game}/home?discord=error`, origin));
    }

    const tokens = await tokenRes.json();
    const accessToken: string = tokens.access_token;
    const refreshToken: string | null = tokens.refresh_token ?? null;
    const expiresIn: number = tokens.expires_in;
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // 3. Discord user info
    const userRes = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      return NextResponse.redirect(new URL(`/${game}/home?discord=error`, origin));
    }
    const discordUser = await userRes.json();
    const discordId: string = discordUser.id;
    const discordUsername: string = discordUser.global_name ?? discordUser.username;

    // 4. Guilds
    const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!guildsRes.ok) {
      return NextResponse.redirect(new URL(`/${game}/home?discord=error`, origin));
    }
    const guilds = await guildsRes.json();
    const guildData = (guilds as { id: string; name: string; icon: string | null }[]).map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
    }));

    // 5. discord_connections UPSERT: onConflict は (user_id, game_title)
    const { error: upsertError } = await supabaseAdmin
      .from("discord_connections")
      .upsert(
        {
          user_id: userId,
          game_title: game,
          discord_id: discordId,
          discord_username: discordUsername,
          access_token: accessToken,
          refresh_token: refreshToken,
          token_expires_at: tokenExpiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,game_title" }
      );

    if (upsertError) {
      console.error("discord_connections upsert error:", upsertError);
      return NextResponse.redirect(new URL(`/${game}/home?discord=error`, origin));
    }

    // 6. Team 同期 (p_game_title 付き)
    const { error: syncError } = await supabaseAdmin.rpc("sync_team_membership", {
      p_user_id: userId,
      p_discord_username: discordUsername,
      p_guilds: guildData,
      p_game_title: game,
    });

    if (syncError) {
      console.error("sync_team_membership error:", syncError);
    }

    return NextResponse.redirect(new URL(`/${game}/home?discord=connected`, origin));
  } catch (err) {
    console.error("Discord callback error:", err);
    return NextResponse.redirect(new URL(`/${game}/home?discord=error`, origin));
  }
}
