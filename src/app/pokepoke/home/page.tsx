"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";
import { getDiscordConnection, getMyTeamsWithVisibility, getTeamMembers, getTeamMemberSummaries, disconnectDiscord, toggleTeamVisibility, refreshGuilds } from "@/lib/actions/team-actions";
import type { DiscordConnection, TeamWithVisibility, TeamMember, TeamMemberSummary } from "@/lib/actions/team-actions";
import { useActiveTeam } from "@/hooks/use-active-team";
import { BottomNav } from "@/components/layout/BottomNav";
import { GameSelector } from "@/components/ui/GameSelector";
import { MemberAvatarStack } from "@/components/ui/MemberAvatarStack";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { getWinRateColor } from "@/lib/stats-utils";


function HomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeTeamId, setActiveTeamId, ready: teamReady } = useActiveTeam();

  const [loading, setLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [connection, setConnection] = useState<DiscordConnection | null>(null);
  const [teams, setTeams] = useState<TeamWithVisibility[]>([]);
  const [disconnecting, setDisconnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hiddenExpanded, setHiddenExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // メンバー一覧機能用state
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [teamMembersMap, setTeamMembersMap] = useState<Record<string, TeamMember[]>>({});
  const [teamMemberStats, setTeamMemberStats] = useState<Record<string, TeamMemberSummary[]>>({});
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const visibleTeams = teams.filter((t) => !t.hidden);
  const hiddenTeams = teams.filter((t) => t.hidden);

  const loadData = useCallback(async () => {
    try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/auth");
      return;
    }

    if (user.is_anonymous) {
      await supabase.auth.signOut();
      router.replace("/auth");
      return;
    }

    setIsGuest(false);
    setCurrentUserId(user.id);

    const conn = await getDiscordConnection("pokepoke");
    setConnection(conn);

    if (conn) {
      const myTeams = await getMyTeamsWithVisibility("pokepoke");
      setTeams(myTeams);

      // 共有中チームのメンバー一覧を取得（アバタースタック用）
      const visible = myTeams.filter((t) => !t.hidden);
      const memberResults = await Promise.all(
        visible.map((t) => getTeamMembers(t.id).then((members) => ({ teamId: t.id, members })))
      );
      const membersMap: Record<string, TeamMember[]> = {};
      for (const r of memberResults) {
        membersMap[r.teamId] = r.members;
      }
      setTeamMembersMap(membersMap);
    }

    setLoading(false);
    } catch {
      setError("データの読み込みに失敗しました");
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!loading && connection) {
      refreshGuilds("pokepoke").then((ok) => {
        if (ok) {
          getMyTeamsWithVisibility("pokepoke").then(setTeams);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, !!connection]);

  // Auto-select first visible team if none selected
  useEffect(() => {
    if (!loading && teamReady && !activeTeamId && visibleTeams.length > 0) {
      setActiveTeamId(visibleTeams[0].id);
    }
  }, [loading, teamReady, activeTeamId, visibleTeams, setActiveTeamId]);

  useEffect(() => {
    if (!loading && teamReady && activeTeamId && visibleTeams.length > 0 && !visibleTeams.find((t) => t.id === activeTeamId)) {
      setActiveTeamId(visibleTeams[0].id);
    }
  }, [loading, teamReady, activeTeamId, visibleTeams, setActiveTeamId]);

  useEffect(() => {
    if (!loading && teamReady && activeTeamId && visibleTeams.length === 0) {
      setActiveTeamId(null);
    }
  }, [loading, teamReady, activeTeamId, visibleTeams, setActiveTeamId]);

  // カード展開時にメンバー勝敗データを遅延ロード
  useEffect(() => {
    for (const teamId of expandedTeams) {
      if (!teamMemberStats[teamId]) {
        getTeamMemberSummaries(teamId).then((stats) => {
          setTeamMemberStats((prev) => ({ ...prev, [teamId]: stats }));
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTeams]);

  const toggleTeamExpand = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const handleDiscordConnect = async () => {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const res = await fetch("/api/discord/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ game: "pokepoke" }),
    });

    if (!res.ok) {
      alert("Discord 連携の開始に失敗しました。時間をおいて再試行してください。");
      return;
    }

    const { authorizeUrl } = await res.json();
    window.location.href = authorizeUrl;
  };

  const handleDisconnect = async () => {
    if (!confirm("Discord連携を解除しますか？サーバー情報も削除されます。")) return;
    setDisconnecting(true);
    const ok = await disconnectDiscord("pokepoke");
    if (ok) {
      setConnection(null);
      setTeams([]);
      setActiveTeamId(null);
    }
    setDisconnecting(false);
  };

  const handleToggleVisibility = async (teamId: string, currentlyHidden: boolean) => {
    if (!currentlyHidden) {
      if (!confirm("このサーバーを非表示にすると、戦績の共有も停止されます。")) return;
    }
    const ok = await toggleTeamVisibility(teamId, !currentlyHidden);
    if (ok) {
      setTeams((prev) =>
        prev.map((t) => (t.id === teamId ? { ...t, hidden: !currentlyHidden } : t))
      );
    }
  };

  const handleManualRefresh = async () => {
    setRefreshing(true);
    const ok = await refreshGuilds("pokepoke");
    if (ok) {
      const myTeams = await getMyTeamsWithVisibility("pokepoke");
      setTeams(myTeams);
    }
    setRefreshing(false);
  };

  const handleMemberTap = (teamId: string, member: TeamMemberSummary) => {
    setActiveTeamId(teamId);
    router.push(`/stats?scope=team&member=${member.user_id}`);
  };

  const discordStatus = searchParams.get("discord");

  if (error) {
    return (
      <>
        <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
          <p className="text-center text-destructive py-12 text-sm">{error}</p>
        </div>
        <BottomNav />
      </>
    );
  }

  if (loading) {
    return (
      <>
        <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
          <div className="animate-pulse rounded-[8px] bg-surface-2 h-6 w-28 mb-5" />
          <div className="space-y-3">
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[72px]" />
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[72px]" />
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[72px]" />
          </div>
        </div>
        <BottomNav />
      </>
    );
  }

  const renderTeamCard = (team: TeamWithVisibility) => {
    const isShared = !team.hidden;
    const isExpanded = expandedTeams.has(team.id);
    const members = teamMembersMap[team.id] ?? [];
    const memberStats = teamMemberStats[team.id];

    return (
      <div key={team.id} className="rounded-xl border border-border-subtle overflow-hidden">
        <div className="flex items-center gap-2">
          <button
            onClick={() => isShared && toggleTeamExpand(team.id)}
            className={`flex-1 min-w-0 flex items-center gap-3 p-3 transition-colors text-left overflow-hidden ${
              !isShared
                ? "opacity-50"
                : ""
            }`}
            disabled={!isShared}
          >
            {team.icon_url ? (
              // Discord CDN の外部小サイズアイコン。Cloudflare Workers + OpenNext 環境では
              // next/image の Image Optimization が使えないため、<img> のまま運用する。
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={team.icon_url}
                alt=""
                className="w-10 h-10 rounded-full object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center text-sm font-medium text-muted-foreground flex-shrink-0">
                {team.name.charAt(0)}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{team.name}</p>
                {isShared && (
                  <span className="text-[10px] bg-success/15 text-success px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">
                    共有中
                  </span>
                )}
              </div>
              {isShared && members.length > 0 && (
                <div className="flex items-center gap-1.5 mt-1">
                  <MemberAvatarStack members={members} max={4} />
                  <span className="text-[10px] text-muted-foreground">{members.length}人</span>
                </div>
              )}
            </div>
            {isShared && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`text-muted-foreground flex-shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            )}
          </button>
          <button
            onClick={() => handleToggleVisibility(team.id, team.hidden)}
            className="flex-shrink-0 p-3 pl-0"
            title={team.hidden ? "共有を開始" : "共有を停止"}
          >
            <div className={`w-10 h-5 rounded-full transition-colors duration-200 flex items-center ${
              isShared ? "bg-success" : "bg-muted/50"
            }`}>
              <span className={`w-4 h-4 rounded-full shadow-sm transition-transform duration-200 mx-0.5 ${
                isShared ? "translate-x-5 bg-white" : "translate-x-0 bg-muted-foreground/50"
              }`} />
            </div>
          </button>
        </div>

        {/* 展開時のメンバー一覧 */}
        {isShared && isExpanded && (
          <div style={{ backgroundColor: "var(--surface-1)", borderTop: "0.5px solid var(--surface-3)" }}>
            {!memberStats ? (
              <div className="flex justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : memberStats.length === 0 ? (
              <p className="text-center text-muted-foreground text-xs py-4">メンバーがいません</p>
            ) : (
              memberStats.map((member) => (
                <button
                  key={member.user_id}
                  onClick={(e) => { e.stopPropagation(); handleMemberTap(team.id, member); }}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors hover:bg-white/5"
                  style={{ borderBottom: "0.5px solid var(--surface-3)" }}
                >
                  <MemberAvatar userId={member.user_id} username={member.discord_username} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] text-foreground truncate">{member.discord_username}</span>
                      {member.user_id === currentUserId && (
                        <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">自分</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                    {member.total > 0 ? (
                      <>
                        <span className="text-[12px] font-medium" style={{ color: getWinRateColor(member.winRate) }}>{member.winRate === null ? "--" : member.winRate}%</span>
                        <span className="text-[10px] text-muted-foreground">{member.wins}勝{member.losses}敗{member.draws}分</span>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">-- 0勝0敗0分</span>
                    )}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/50 flex-shrink-0">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto space-y-4">
        <h1 className="text-xl font-bold">ホーム</h1>

        <GameSelector currentGame="pokepoke" size="large" />

        {discordStatus === "connected" && (
          <div className="rounded-lg bg-success/10 border border-success/30 px-4 py-3 text-sm text-success">
            Discordとの連携が完了しました
          </div>
        )}
        {discordStatus === "error" && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
            Discord連携に失敗しました。もう一度お試しください。
          </div>
        )}

        {!connection ? (
          <div className="rounded-xl border border-border p-6 space-y-4">
            <div className="space-y-2">
              <h2 className="text-base font-bold">Discord連携</h2>
              <p className="text-sm text-muted-foreground">
                Discordと連携すると、同じサーバーのメンバーと戦績を共有できます。
              </p>
            </div>
            {isGuest ? (
              <p className="text-sm text-muted-foreground bg-muted/20 rounded-lg px-4 py-3">
                Discord連携にはアカウント登録が必要です
              </p>
            ) : (
              <button
                onClick={handleDiscordConnect}
                className="w-full rounded-lg px-4 py-3 text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: "#5865F2" }}
              >
                Discordと連携する
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: "#5865F2" }}>
                    <svg width="16" height="12" viewBox="0 0 16 12" fill="white">
                      <path d="M13.55 1.01A13.3 13.3 0 0010.26 0a.05.05 0 00-.05.02c-.14.25-.3.58-.41.84a12.3 12.3 0 00-3.6 0 8.6 8.6 0 00-.42-.84.05.05 0 00-.05-.02c-1.15.2-2.24.56-3.29 1.01a.05.05 0 00-.02.02C.39 3.95-.24 6.8.07 9.61a.06.06 0 00.02.04 13.4 13.4 0 004.03 2.01.05.05 0 00.06-.02c.31-.42.59-.86.83-1.33a.05.05 0 00-.03-.07 8.8 8.8 0 01-1.25-.59.05.05 0 01-.01-.08c.08-.06.17-.13.25-.19a.05.05 0 01.05-.01c2.63 1.18 5.47 1.18 8.07 0a.05.05 0 01.05 0c.08.07.17.13.25.2a.05.05 0 010 .08c-.4.23-.82.43-1.26.59a.05.05 0 00-.02.07c.24.47.52.91.82 1.33a.05.05 0 00.06.02 13.4 13.4 0 004.04-2.01.05.05 0 00.02-.04c.37-3.34-.62-6.16-2.63-8.58a.04.04 0 00-.02-.02zM5.34 7.88c-.76 0-1.38-.69-1.38-1.53s.61-1.53 1.38-1.53c.78 0 1.4.69 1.39 1.53 0 .84-.61 1.53-1.39 1.53zm5.14 0c-.76 0-1.38-.69-1.38-1.53s.61-1.53 1.38-1.53c.78 0 1.4.69 1.39 1.53 0 .84-.61 1.53-1.39 1.53z"/>
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{connection.discord_username}</p>
                    <p className="text-xs text-muted-foreground">Discord連携済み</p>
                  </div>
                </div>
                <button
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-xs text-destructive hover:opacity-80 transition-opacity disabled:opacity-50"
                >
                  {disconnecting ? "解除中..." : "連携解除"}
                </button>
              </div>
            </div>

            {/* Team list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold">所属サーバー</h2>
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={handleManualRefresh}
                    disabled={refreshing}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    title="サーバー情報を更新"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={refreshing ? "animate-spin" : ""}
                    >
                      <polyline points="23 4 23 10 17 10" />
                      <polyline points="1 20 1 14 7 14" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                  </button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                戦績を共有するDiscordサーバーを選択してください
              </p>

              {teams.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  所属サーバーがありません
                </p>
              ) : (
                <div className="space-y-4">
                  {visibleTeams.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-success">戦績を共有中</p>
                      {visibleTeams.map((team) => renderTeamCard(team))}
                    </div>
                  )}

                  {hiddenTeams.length > 0 && (
                    <div>
                      <button
                        onClick={() => setHiddenExpanded(!hiddenExpanded)}
                        className="flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className={`transition-transform duration-200 ${hiddenExpanded ? "rotate-90" : ""}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        共有していないサーバー（{hiddenTeams.length}件）
                      </button>
                      <div className={`grid transition-[grid-template-rows] duration-200 ${
                        hiddenExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                      }`}>
                        <div className="overflow-hidden">
                          <div className="space-y-2 pt-2">
                            {hiddenTeams.map((team) => renderTeamCard(team))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <BottomNav />
    </>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <><div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
          <div className="animate-pulse rounded-[8px] bg-surface-2 h-6 w-28 mb-5" />
          <div className="space-y-3">
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[72px]" />
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[72px]" />
          </div>
        </div><BottomNav /></>
      }
    >
      <HomePageInner />
    </Suspense>
  );
}
