"use client";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getDetailedPersonalStats, getGlobalStatsByRange, getDeckTrendByRange, getTeamStatsByRange, getTeamDeckTrendByRange } from "@/lib/actions/stats-actions";
import type { DetailedPersonalStats, TrendRow } from "@/lib/actions/stats-actions";
import { getDailyBattleCounts, getOpponentDeckSuggestions } from "@/lib/actions/battle-actions";
import { getOpponentDeckNameMap, displayDeckName, type OpponentDeckNameMap } from "@/lib/actions/opponent-deck-display";
import { getTeamMembers, getMyTeamsWithVisibility } from "@/lib/actions/team-actions";
import type { TeamMember, TeamWithVisibility } from "@/lib/actions/team-actions";
import { useFormat } from "@/hooks/use-format";
import { useActiveTeam } from "@/hooks/use-active-team";
import { FormatSelector } from "@/components/ui/FormatSelector";
import { ScopeSelector } from "@/components/ui/ScopeSelector";
import type { Scope } from "@/components/ui/ScopeSelector";
import { ViewSelector } from "@/components/ui/ViewSelector";
import type { View } from "@/components/ui/ViewSelector";
import { DateRangeCalendar } from "@/components/battle/DateRangeCalendar";
import { MyDeckStatsSection } from "@/components/stats/MyDeckStatsSection";
import { OpponentDeckStatsSection } from "@/components/stats/OpponentDeckStatsSection";
import { EncounterDonutChart } from "@/components/stats/EncounterDonutChart";
import { TrendChart } from "@/components/stats/TrendChart";
import { TrendHeatmap } from "@/components/stats/TrendHeatmap";
import { TeamServerCard } from "@/components/stats/TeamServerCard";
import { BottomNav } from "@/components/layout/BottomNav";
import { Crown, Lock } from "lucide-react";
import { getWinRateColor } from "@/lib/stats-utils";
import { TurnOrderCards } from "@/components/stats/TurnOrderCards";
import { ShareButton } from "@/components/share/ShareButton";
import type { StatsShareData } from "@/components/share/ShareButton";
import { FilterBar } from "@/components/stats/FilterBar";
import { getUserStage, getAuthProvider, getXConnectionStatus } from "@/lib/actions/account-actions";
import { getPremiumUiVisible } from "@/lib/actions/admin-actions";

function StatsPageInner() {
  const searchParams = useSearchParams();
  const { format, setFormat, ready } = useFormat();
  const { activeTeamId, setActiveTeamId, ready: teamReady } = useActiveTeam();
  const [scope, setScope] = useState<Scope>(() => {
    const sp = searchParams.get("scope");
    return (sp === "personal" || sp === "global" || sp === "team") ? sp : "personal";
  });
  const [view, setView] = useState<View>("stats");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userStage, setUserStage] = useState<number>(2);
  const [premiumFilter, setPremiumFilter] = useState(false);
  const [premiumUiVisible, setPremiumUiVisible] = useState(true);
  const [xConnected, setXConnected] = useState(false);

  // Safety: reset premiumFilter when admin hides UI
  useEffect(() => {
    if (!premiumUiVisible) setPremiumFilter(false);
  }, [premiumUiVisible]);
  const [isGuest, setIsGuest] = useState(false);
  const [battleCounts, setBattleCounts] = useState<Record<string, number>>({});

  const [startDate, setStartDate] = useState(() => {
    return searchParams.get("start") || (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      return d.toLocaleDateString("sv-SE");
    })();
  });
  const [endDate, setEndDate] = useState(() => {
    return searchParams.get("end") || new Date().toLocaleDateString("sv-SE");
  });

  // Data states
  const [personalStats, setPersonalStats] = useState<DetailedPersonalStats>({ myDeckStats: [], opponentDeckStats: [], turnOrder: { firstWins: 0, firstLosses: 0, firstDraws: 0, secondWins: 0, secondLosses: 0, secondDraws: 0, unknownWins: 0, unknownLosses: 0, unknownDraws: 0 } });
  const [globalStats, setGlobalStats] = useState<DetailedPersonalStats>({ myDeckStats: [], opponentDeckStats: [], turnOrder: { firstWins: 0, firstLosses: 0, firstDraws: 0, secondWins: 0, secondLosses: 0, secondDraws: 0, unknownWins: 0, unknownLosses: 0, unknownDraws: 0 } });
  const [teamStats, setTeamStats] = useState<DetailedPersonalStats>({ myDeckStats: [], opponentDeckStats: [], turnOrder: { firstWins: 0, firstLosses: 0, firstDraws: 0, secondWins: 0, secondLosses: 0, secondDraws: 0, unknownWins: 0, unknownLosses: 0, unknownDraws: 0 } });
  const [trendData, setTrendData] = useState<TrendRow[]>([]);
  const [deckCategories, setDeckCategories] = useState<{ major: string[]; minor: string[]; other: string[] }>({ major: [], minor: [], other: [] });
  const [opponentDeckNameMap, setOpponentDeckNameMap] = useState<OpponentDeckNameMap>({});
  const [nameMapFormat, setNameMapFormat] = useState<string | null>(null);
  const nameMapReady = nameMapFormat === format;
  const [trendMode, setTrendMode] = useState<"line" | "heatmap">("line");
  const [trendCalcMode, setTrendCalcMode] = useState<"daily" | "cumulative">("daily");

  // Team states
  const [visibleTeams, setVisibleTeams] = useState<TeamWithVisibility[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(() => {
    return searchParams.get("member") || null;
  });
  const activeVisibleTeamId = useMemo(
    () => visibleTeams.some((t) => t.id === activeTeamId) ? activeTeamId : null,
    [visibleTeams, activeTeamId]
  );
  const handleTeamSelect = useCallback((teamId: string) => {
    setActiveTeamId(teamId);
    setSelectedMemberId(null);
  }, [setActiveTeamId]);

  // Load visible teams
  useEffect(() => {
    getMyTeamsWithVisibility("pokepoke").then((teams) => {
      setVisibleTeams(teams.filter((t) => !t.hidden));
    });
    getUserStage().then(setUserStage);
    getAuthProvider().then(p => setIsGuest(p === "anonymous"));
    getXConnectionStatus().then(r => setXConnected(r.isConnected));
    getPremiumUiVisible().then(setPremiumUiVisible);
  }, []);

  // Load team members when active team changes
  useEffect(() => {
    if (activeVisibleTeamId) {
      getTeamMembers(activeVisibleTeamId).then(setTeamMembers);
    } else {
      setTeamMembers([]);
    }
  }, [activeVisibleTeamId]);

  // Discordタブ内でもサーバーを選べるよう、未選択時は最初の共有中サーバーを仮選択する
  useEffect(() => {
    if (scope !== "team" || !teamReady || visibleTeams.length === 0 || activeVisibleTeamId) return;
    setActiveTeamId(visibleTeams[0].id);
    setSelectedMemberId(null);
  }, [scope, teamReady, visibleTeams, activeVisibleTeamId, setActiveTeamId]);

  // Reset selectedMemberId when scope changes away from team
  useEffect(() => {
    if (scope !== "team") {
      setSelectedMemberId(null);
    }
  }, [scope]);

  // Fetch deck categories
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getOpponentDeckSuggestions(format, "pokepoke").then((cats) => {
      if (!cancelled) setDeckCategories(cats);
    });
    getOpponentDeckNameMap(format, "pokepoke").then((map) => {
      if (cancelled) return;
      setOpponentDeckNameMap(map);
      setNameMapFormat(format);
    });
    return () => { cancelled = true; };
  }, [format, ready]);

  const categoryMap = useMemo(() => {
    const m = new Map<string, "major" | "minor" | "other">();
    for (const name of deckCategories.major) m.set(name, "major");
    for (const name of deckCategories.minor) m.set(name, "minor");
    for (const name of deckCategories.other) m.set(name, "other");
    return m;
  }, [deckCategories]);

  // Compute cumulative trend data from daily data
  const cumulativeTrendData = useMemo(() => {
    if (trendData.length === 0) return [];
    const periods = [...new Set(trendData.map(d => d.periodStart))].sort();
    const deckNames = [...new Set(trendData.map(d => d.deckName))];
    const lookup = new Map<string, Map<string, number>>();
    for (const d of trendData) {
      if (!lookup.has(d.periodStart)) lookup.set(d.periodStart, new Map());
      lookup.get(d.periodStart)!.set(d.deckName, d.battleCount);
    }
    const cumCounts = new Map<string, number>();
    const result: TrendRow[] = [];
    for (const period of periods) {
      for (const deck of deckNames) {
        const count = lookup.get(period)?.get(deck) ?? 0;
        cumCounts.set(deck, (cumCounts.get(deck) ?? 0) + count);
      }
      let totalCum = 0;
      for (const c of cumCounts.values()) totalCum += c;
      for (const deck of deckNames) {
        const cumCount = cumCounts.get(deck) ?? 0;
        if (cumCount > 0) {
          result.push({
            periodStart: period,
            deckName: deck,
            battleCount: cumCount,
            sharePct: totalCum > 0 ? Math.round((cumCount / totalCum) * 100) : 0,
          });
        }
      }
    }
    return result;
  }, [trendData]);

  // Apply calc mode + major-only filter
  const filteredTrendData = useMemo(() => {
    const source = trendCalcMode === "daily" ? trendData : cumulativeTrendData;
    if (deckCategories.major.length === 0) return source;
    const majorSet = new Set(deckCategories.major);
    return source.filter(row => majorSet.has(row.deckName));
  }, [trendData, cumulativeTrendData, trendCalcMode, deckCategories.major]);

  const loadData = useCallback(async () => {
    if (!ready || !teamReady) {
      return;
    }

    if (scope === "team" && !activeVisibleTeamId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
    if (scope === "personal" && view === "stats") {
      const s = await getDetailedPersonalStats(format, startDate, endDate);
      setPersonalStats(s);
    } else if (scope === "personal" && view === "trend") {
      const t = await getDeckTrendByRange(startDate, endDate, format, true);
      setTrendData(t);
    } else if (scope === "global" && view === "stats") {
      const maxStage = premiumFilter ? 1 : undefined;
      const s = await getGlobalStatsByRange(startDate, endDate, format, maxStage);
      setGlobalStats(s);
    } else if (scope === "global" && view === "trend") {
      const maxStage = premiumFilter ? 1 : undefined;
      const t = await getDeckTrendByRange(startDate, endDate, format, false, maxStage);
      setTrendData(t);
    } else if (scope === "team" && activeVisibleTeamId && view === "stats") {
      const s = await getTeamStatsByRange(activeVisibleTeamId, selectedMemberId, format, startDate, endDate);
      setTeamStats(s);
    } else if (scope === "team" && activeVisibleTeamId && view === "trend") {
      const t = await getTeamDeckTrendByRange(activeVisibleTeamId, selectedMemberId, startDate, endDate, format);
      setTrendData(t);
    }

    } catch {
      console.error("Failed to load stats data");
      setError("データの読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [format, startDate, endDate, ready, teamReady, scope, view, activeVisibleTeamId, selectedMemberId, premiumFilter]);

  const loadCounts = useCallback((year: number, month: number) => {
    if (!ready) return;
    getDailyBattleCounts(format, year, month, "pokepoke").then(setBattleCounts);
  }, [format, ready]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const now = new Date();
    loadCounts(now.getFullYear(), now.getMonth() + 1);
  }, [loadCounts]);

  const handleRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const renderContent = () => {
    if (error) {
      return <p className="text-center text-red-400 py-12 text-sm">{error}</p>;
    }

    if (scope === "team" && !activeVisibleTeamId) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">Discord サーバーを選択してください</p>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="space-y-4">
          <div className="flex justify-center py-6"><div className="animate-pulse rounded-full bg-surface-2 h-[180px] w-[180px]" /></div>
          <div className="animate-pulse rounded-[10px] bg-surface-2 h-[60px]" />
          <div className="animate-pulse rounded-[10px] bg-surface-2 h-[60px]" />
          <div className="animate-pulse rounded-[10px] bg-surface-2 h-[60px]" />
        </div>
      );
    }

    if (view === "stats") {
      const stats = scope === "personal" ? personalStats : scope === "global" ? globalStats : teamStats;
      const totalWins = stats.myDeckStats.reduce((sum, d) => sum + d.wins, 0);
      const totalLosses = stats.myDeckStats.reduce((sum, d) => sum + d.losses, 0);
      const totalDraws = stats.myDeckStats.reduce((sum, d) => sum + d.draws, 0);
      const totalBattles = totalWins + totalLosses + totalDraws;
      const overallWinRate = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : null;

      // Aggregate opponent deck stats: major/minor individual, other -> "その他"
      const aggregatedDonut: { name: string; total: number; winRate: number | null }[] = [];
      const otherBreakdown: { name: string; total: number; winRate: number | null }[] = [];
      let otherWins = 0, otherLosses = 0, otherDraws = 0, otherTotal = 0;
      for (const o of stats.opponentDeckStats) {
        const cat = categoryMap.get(o.deckName) ?? "other";
        if (cat === "major" || cat === "minor") {
          aggregatedDonut.push({ name: o.deckName, total: o.total, winRate: o.winRate });
        } else {
          otherWins += o.wins;
          otherLosses += o.losses;
          otherDraws += o.draws;
          otherTotal += o.total;
          otherBreakdown.push({ name: o.deckName, total: o.total, winRate: o.winRate });
        }
      }
      if (otherTotal > 0) {
        const otherWinRate = (otherWins + otherLosses) > 0 ? Math.round((otherWins / (otherWins + otherLosses)) * 100) : null;
        aggregatedDonut.push({ name: "その他", total: otherTotal, winRate: otherWinRate });
      }

      // Aggregate myDeckStats for global scope
      const otherMyDeckNames: string[] = [];
      const myDeckData = scope === "global" && categoryMap.size > 0 ? (() => {
        const kept: typeof stats.myDeckStats = [];
        let mOtherWins = 0, mOtherLosses = 0, mOtherDraws = 0, mOtherTotal = 0;
        for (const d of stats.myDeckStats) {
          const cat = categoryMap.get(d.deckName) ?? "other";
          if (cat === "major" || cat === "minor") {
            kept.push(d);
          } else {
            mOtherWins += d.wins;
            mOtherLosses += d.losses;
            mOtherDraws += d.draws;
            mOtherTotal += d.total;
            otherMyDeckNames.push(d.deckName);
          }
        }
        if (mOtherTotal > 0) {
          const mOtherWinRate = (mOtherWins + mOtherLosses) > 0 ? Math.round((mOtherWins / (mOtherWins + mOtherLosses)) * 100) : null;
          kept.push({ deckName: "その他", wins: mOtherWins, losses: mOtherLosses, draws: mOtherDraws, total: mOtherTotal, winRate: mOtherWinRate, opponents: [] });
        }
        return kept;
      })() : stats.myDeckStats;

      return (
        <>
          <div>
            <h2 className="text-base font-bold mb-2">対面デッキ分布</h2>
            {stats.opponentDeckStats.length > 0 ? (
              <EncounterDonutChart
                items={categoryMap.size > 0 ? aggregatedDonut : stats.opponentDeckStats.map(o => ({ name: o.deckName, total: o.total, winRate: o.winRate }))}
                otherBreakdown={otherBreakdown}
                overallWinRate={overallWinRate}
                overallWins={totalWins}
                overallLosses={totalLosses}
                overallDraws={totalDraws}
                overallTotal={totalBattles}
                opponentDeckNameMap={opponentDeckNameMap}
                game="pokepoke"
              />
            ) : (
              <p className="text-center text-muted-foreground py-4 text-sm">データがありません</p>
            )}
          </div>
          <div>
            <h2 className="text-base font-bold mb-2">先攻/後攻別</h2>
            <TurnOrderCards
              firstWins={stats.turnOrder.firstWins} firstLosses={stats.turnOrder.firstLosses} firstDraws={stats.turnOrder.firstDraws} firstTotal={stats.turnOrder.firstWins + stats.turnOrder.firstLosses + stats.turnOrder.firstDraws}
              secondWins={stats.turnOrder.secondWins} secondLosses={stats.turnOrder.secondLosses} secondDraws={stats.turnOrder.secondDraws} secondTotal={stats.turnOrder.secondWins + stats.turnOrder.secondLosses + stats.turnOrder.secondDraws}
              unknownWins={stats.turnOrder.unknownWins} unknownLosses={stats.turnOrder.unknownLosses} unknownDraws={stats.turnOrder.unknownDraws} unknownTotal={stats.turnOrder.unknownWins + stats.turnOrder.unknownLosses + stats.turnOrder.unknownDraws}
              game="pokepoke"
            />
          </div>
          <div>
            <h2 className="text-base font-bold mb-2">使用デッキ別</h2>
            {scope === "global" && categoryMap.size > 0 && (
              <p className="text-xs text-muted-foreground">※ 使用率の低いデッキは「その他」に集約されています</p>
            )}
            <MyDeckStatsSection stats={myDeckData} startDate={startDate} endDate={endDate} scope={scope} teamId={activeVisibleTeamId ?? undefined} memberId={selectedMemberId} memberName={selectedMemberId ? (teamMembers.find(m => m.user_id === selectedMemberId)?.discord_username ?? null) : null} otherDeckNames={otherMyDeckNames} premiumFilter={premiumFilter} game="pokepoke" />
          </div>
          <div>
            <h2 className="text-base font-bold mb-2">対面デッキ別</h2>
            <OpponentDeckStatsSection stats={stats.opponentDeckStats} startDate={startDate} endDate={endDate} scope={scope} teamId={activeVisibleTeamId ?? undefined} memberId={selectedMemberId} memberName={selectedMemberId ? (teamMembers.find(m => m.user_id === selectedMemberId)?.discord_username ?? null) : null} premiumFilter={premiumFilter} opponentDeckNameMap={opponentDeckNameMap} game="pokepoke" />
          </div>
        </>
      );
    }

    if (view === "trend") {
      return (
        <>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <div className="flex rounded-full border border-border overflow-hidden">
              <button onClick={() => setTrendMode("line")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${trendMode === "line" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                折れ線
              </button>
              <button onClick={() => setTrendMode("heatmap")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${trendMode === "heatmap" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                ヒートマップ
              </button>
            </div>
            <div className="flex rounded-full border border-border overflow-hidden">
              <button onClick={() => setTrendCalcMode("daily")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${trendCalcMode === "daily" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                単日
              </button>
              <button onClick={() => setTrendCalcMode("cumulative")}
                className={`px-3 py-1 text-xs font-medium transition-colors ${trendCalcMode === "cumulative" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                累計
              </button>
            </div>
          </div>
          {deckCategories.major.length > 0 && (
            <p className="text-xs text-muted-foreground">※ 使用率の高いデッキのみ表示されています</p>
          )}
          {trendMode === "line"
            ? <TrendChart data={filteredTrendData} opponentDeckNameMap={opponentDeckNameMap} />
            : <TrendHeatmap data={filteredTrendData} />
          }
        </>
      );
    }

    return null;
  };

  return (
    <>
      <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">分析</h1>
            {scope === "personal" && view === "stats" && nameMapReady && (() => {
              const stats = personalStats;
              const totalWins = stats.myDeckStats.reduce((sum, d) => sum + d.wins, 0);
              const totalLosses = stats.myDeckStats.reduce((sum, d) => sum + d.losses, 0);
              const totalDraws = stats.myDeckStats.reduce((sum, d) => sum + d.draws, 0);
              const totalBattles = totalWins + totalLosses + totalDraws;
              if (totalBattles === 0) return null;
              const winRateVal = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : null;
              const shareData: StatsShareData = {
                totalWins,
                totalLosses,
                totalDraws,
                winRate: winRateVal,
                firstWins: stats.turnOrder.firstWins,
                firstLosses: stats.turnOrder.firstLosses,
                firstDraws: stats.turnOrder.firstDraws,
                secondWins: stats.turnOrder.secondWins,
                secondLosses: stats.turnOrder.secondLosses,
                secondDraws: stats.turnOrder.secondDraws,
                unknownWins: stats.turnOrder.unknownWins,
                unknownLosses: stats.turnOrder.unknownLosses,
                unknownDraws: stats.turnOrder.unknownDraws,
                encounterDistribution: (() => {
                  const allOpponents = stats.opponentDeckStats.map(d => ({ name: displayDeckName(d.deckName, opponentDeckNameMap), count: d.wins + d.losses + d.draws, winRate: d.winRate }));
                  const topN = allOpponents.slice(0, 5);
                  const otherWins = stats.opponentDeckStats.slice(5).reduce((s, d) => s + d.wins, 0);
                  const otherLosses = stats.opponentDeckStats.slice(5).reduce((s, d) => s + d.losses, 0);
                  const otherDraws = stats.opponentDeckStats.slice(5).reduce((s, d) => s + d.draws, 0);
                  const otherCount = otherWins + otherLosses + otherDraws;
                  if (otherCount > 0) {
                    const otherRate = (otherWins + otherLosses) > 0 ? Math.round((otherWins / (otherWins + otherLosses)) * 100) : null;
                    topN.push({ name: "その他", count: otherCount, winRate: otherRate });
                  }
                  const total = topN.reduce((s, d) => s + d.count, 0);
                  return topN.map(d => ({ name: d.name, count: d.count, percentage: total > 0 ? Math.round((d.count / total) * 100) : 0, winRate: d.winRate }));
                })(),
                period: `${startDate} ~ ${endDate}`,
                format,
                game: "pokepoke",
              };
              return <ShareButton type="stats" data={shareData} xConnected={xConnected} />;
            })()}
          </div>
          <div className={!ready ? "invisible" : ""}>
            <FormatSelector format={format} setFormat={setFormat} />
          </div>
        </div>
        {(!ready || !teamReady) ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <>
            <FilterBar>
              <DateRangeCalendar
                startDate={startDate}
                endDate={endDate}
                onRangeChange={handleRangeChange}
                battleCounts={battleCounts}
                onMonthChange={loadCounts}
              />
              <ScopeSelector scope={scope} setScope={setScope} teamEnabled={visibleTeams.length > 0} isGuest={isGuest} />
            </FilterBar>
            {isGuest && (
              <div className="bg-surface-2 rounded-[8px] px-3 py-2.5 text-center border border-border-subtle">
                <p className="text-[11px] text-muted-foreground">全体統計やご意見・バグ報告は<a href="/auth" className="text-primary underline ml-0.5">アカウント登録</a>するとご利用いただけます</p>
              </div>
            )}
            {scope === "global" && premiumUiVisible && (
              <div
                className="rounded-[8px] px-3 py-2.5"
                style={{
                  border: userStage === 1
                    ? "1px solid rgba(217, 170, 59, 0.35)"
                    : "1px solid rgba(100, 100, 150, 0.2)",
                  background: userStage === 1
                    ? "linear-gradient(135deg, rgba(217, 170, 59, 0.08), rgba(180, 130, 30, 0.04))"
                    : "var(--surface-2)",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {userStage === 1 ? (
                      <Crown size={16} className="text-amber-400 flex-shrink-0" />
                    ) : (
                      <Lock size={14} className="text-gray-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className={`text-[12px] font-medium ${userStage === 1 ? "text-amber-400" : "text-gray-400"}`}>
                        優良ユーザー限定
                      </p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {userStage === 1
                          ? "信頼性の高いユーザーの戦績のみで集計します"
                          : "優良ユーザーに認定されると利用できる限定機能です"}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => userStage === 1 && setPremiumFilter(!premiumFilter)}
                    disabled={userStage !== 1}
                    className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ml-3 ${
                      premiumFilter ? "bg-amber-500" : userStage === 1 ? "bg-muted" : "bg-muted"
                    } ${userStage !== 1 ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200 ${
                      premiumFilter ? "left-[22px]" : "left-[2px]"
                    }`} />
                  </button>
                </div>
              </div>
            )}
            {scope === "team" && visibleTeams.length > 0 && (
              <TeamServerCard
                teams={visibleTeams}
                activeTeamId={activeVisibleTeamId}
                onTeamSelect={handleTeamSelect}
                members={teamMembers}
                selectedMemberId={selectedMemberId}
                onMemberSelect={setSelectedMemberId}
              />
            )}
            <ViewSelector view={view} setView={setView} />
            {renderContent()}
          </>
        )}
      </div>
      <BottomNav />
    </>
  );
}

export default function StatsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    }>
      <StatsPageInner />
    </Suspense>
  );
}
