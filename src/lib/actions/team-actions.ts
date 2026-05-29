import { createClient } from "@/lib/supabase/client";
import { DEFAULT_GAME, type GameSlug } from "@/lib/games";
import { AuthExpiredError } from "@/lib/errors/auth-expired-error";

export type DiscordConnection = {
  id: string;
  discord_id: string;
  discord_username: string;
};

export type Team = {
  id: string;
  discord_guild_id: string;
  name: string;
  icon_url: string | null;
};

export type TeamWithVisibility = Team & { hidden: boolean };

export type TeamMember = {
  user_id: string;
  discord_username: string;
};

export async function getDiscordConnection(game: GameSlug = DEFAULT_GAME): Promise<DiscordConnection | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: UI 表示用 (discord 連携状態を画面表示) → AuthExpiredError
  if (!user) throw new AuthExpiredError("getDiscordConnection");

  const { data } = await supabase
    .from("discord_connections")
    .select("id, discord_id, discord_username")
    .eq("user_id", user.id)
    .eq("game_title", game)
    .maybeSingle();

  return data;
}

export async function getMyTeams(game: GameSlug = DEFAULT_GAME): Promise<Team[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: UI 表示用 → AuthExpiredError
  if (!user) throw new AuthExpiredError("getMyTeams");

  const { data: memberships } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", user.id);

  if (!memberships || memberships.length === 0) return [];

  const teamIds = memberships.map((m) => m.team_id);
  const { data: teams } = await supabase
    .from("teams")
    .select("id, discord_guild_id, name, icon_url")
    .in("id", teamIds)
    .eq("game_title", game)
    .order("name");

  return teams ?? [];
}

export async function getMyTeamsWithVisibility(game: GameSlug = DEFAULT_GAME): Promise<TeamWithVisibility[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: UI 表示用 → AuthExpiredError
  if (!user) throw new AuthExpiredError("getMyTeamsWithVisibility");

  const { data: memberships } = await supabase
    .from("team_members")
    .select("team_id, hidden_at")
    .eq("user_id", user.id);

  if (!memberships || memberships.length === 0) return [];

  const teamIds = memberships.map((m) => m.team_id);
  const { data: teams } = await supabase
    .from("teams")
    .select("id, discord_guild_id, name, icon_url")
    .in("id", teamIds)
    .eq("game_title", game)
    .order("name");

  if (!teams) return [];

  const hiddenMap = new Map(memberships.map((m) => [m.team_id, m.hidden_at != null]));
  return teams.map((t) => ({ ...t, hidden: hiddenMap.get(t.id) ?? false }));
}

export async function toggleTeamVisibility(teamId: string, hide: boolean): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: 重要操作 (UPDATE) → AuthExpiredError
  if (!user) throw new AuthExpiredError("toggleTeamVisibility");

  const { error } = await supabase
    .from("team_members")
    .update({ hidden_at: hide ? new Date().toISOString() : null })
    .eq("team_id", teamId)
    .eq("user_id", user.id);

  return !error;
}

export async function getTeamMembers(teamId: string): Promise<TeamMember[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_team_members", {
    p_team_id: teamId,
  });

  if (error) return [];
  return (data as TeamMember[]) ?? [];
}

export async function disconnectDiscord(game: GameSlug = DEFAULT_GAME): Promise<boolean> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // Plan D / D-5: 重要操作 (DELETE) → AuthExpiredError
  if (!user) throw new AuthExpiredError("disconnectDiscord");

  // このゲームで所属するチームのメンバーシップだけ削除
  const { data: gameTeams } = await supabase
    .from("teams")
    .select("id")
    .eq("game_title", game);

  if (gameTeams && gameTeams.length > 0) {
    const gameTeamIds = gameTeams.map((t) => t.id);
    await supabase
      .from("team_members")
      .delete()
      .eq("user_id", user.id)
      .in("team_id", gameTeamIds);
  }

  // このゲームの Discord 接続のみ削除
  const { error } = await supabase
    .from("discord_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("game_title", game);

  return !error;
}

export async function refreshGuilds(game: GameSlug = DEFAULT_GAME): Promise<boolean> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;

  try {
    const res = await fetch("/api/discord/refresh-guilds", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ accessToken: session.access_token, game }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type TeamMemberSummary = {
  user_id: string;
  discord_username: string;
  wins: number;
  losses: number;
  draws: number;
  total: number;
  winRate: number | null;
};

export async function getTeamMemberSummaries(teamId: string): Promise<TeamMemberSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_team_member_summaries", {
    p_team_id: teamId,
  });

  if (error || !data) return [];
  return (data as { user_id: string; discord_username: string; wins: number; losses: number; draws: number | null; total: number }[]).map((d) => {
    const draws = Number(d.draws ?? 0);
    const wl = d.wins + d.losses;
    return {
      user_id: d.user_id,
      discord_username: d.discord_username,
      wins: d.wins,
      losses: d.losses,
      draws,
      total: d.total,
      winRate: wl > 0 ? Math.round((d.wins / wl) * 100) : null,
    };
  });
}
