"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getAdminUserPersonalStats, getAdminUserDeckTrend, getAdminUserDailyBattleCounts } from "@/lib/actions/admin-actions";
import { getOpponentDeckSuggestions } from "@/lib/actions/battle-actions";
import type { DetailedPersonalStats, TrendRow } from "@/lib/actions/stats-actions";
import { DateRangeCalendar } from "@/components/battle/DateRangeCalendar";
import { ViewSelector } from "@/components/ui/ViewSelector";
import type { View } from "@/components/ui/ViewSelector";
import { EncounterDonutChart } from "@/components/stats/EncounterDonutChart";
import { TurnOrderCards } from "@/components/stats/TurnOrderCards";
import { MyDeckStatsSection } from "@/components/stats/MyDeckStatsSection";
import { OpponentDeckStatsSection } from "@/components/stats/OpponentDeckStatsSection";
import { TrendChart } from "@/components/stats/TrendChart";
import { TrendHeatmap } from "@/components/stats/TrendHeatmap";
import { DEFAULT_GAME, type GameSlug } from "@/lib/games";

type Props = {
  userId: string;
  format: string;
  game?: GameSlug;
};

export function AdminUserStats({ userId, format, game = DEFAULT_GAME }: Props) {
  const [view, setView] = useState<View>("stats");
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString("sv-SE");
  });
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [battleCounts, setBattleCounts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState<DetailedPersonalStats>({
    myDeckStats: [], opponentDeckStats: [],
    turnOrder: {
      firstWins: 0, firstLosses: 0, firstDraws: 0,
      secondWins: 0, secondLosses: 0, secondDraws: 0,
      unknownWins: 0, unknownLosses: 0, unknownDraws: 0,
    },
  });
  const [trendData, setTrendData] = useState<TrendRow[]>([]);
  const [trendMode, setTrendMode] = useState<"line" | "heatmap">("line");
  const [trendCalcMode, setTrendCalcMode] = useState<"daily" | "cumulative">("daily");
  const [deckCategories, setDeckCategories] = useState<{ major: string[]; minor: string[]; other: string[] }>({ major: [], minor: [], other: [] });

  useEffect(() => {
    getOpponentDeckSuggestions(format, game).then(setDeckCategories);
  }, [format, game]);

  const categoryMap = useMemo(() => {
    const m = new Map<string, "major" | "minor" | "other">();
    for (const name of deckCategories.major) m.set(name, "major");
    for (const name of deckCategories.minor) m.set(name, "minor");
    for (const name of deckCategories.other) m.set(name, "other");
    return m;
  }, [deckCategories]);

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

  const filteredTrendData = useMemo(() => {
    const source = trendCalcMode === "daily" ? trendData : cumulativeTrendData;
    if (deckCategories.major.length === 0) return source;
    const majorSet = new Set(deckCategories.major);
    return source.filter(row => majorSet.has(row.deckName));
  }, [trendData, cumulativeTrendData, trendCalcMode, deckCategories.major]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      if (view === "stats") {
        const s = await getAdminUserPersonalStats(userId, format, startDate, endDate, game);
        setStats(s);
      } else {
        const t = await getAdminUserDeckTrend(userId, startDate, endDate, format, game);
        setTrendData(t);
      }
    } catch {
      console.error("Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [userId, format, startDate, endDate, view, game]);

  const loadCounts = useCallback((year: number, month: number) => {
    getAdminUserDailyBattleCounts(userId, format, year, month, game).then(setBattleCounts);
  }, [userId, format, game]);

  // loadData は useCallback ラップ済で内部で setState 経由 fetch 反映。
  // 外部状態 (userId/format/startDate/endDate/view/game) 変化時の effect 内呼び出し。
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const now = new Date();
    loadCounts(now.getFullYear(), now.getMonth() + 1);
  }, [loadCounts]);

  const handleRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const renderStats = () => {
    const totalWins = stats.myDeckStats.reduce((sum, d) => sum + d.wins, 0);
    const totalLosses = stats.myDeckStats.reduce((sum, d) => sum + d.losses, 0);
    const totalDraws = stats.myDeckStats.reduce((sum, d) => sum + d.draws, 0);
    const totalBattles = totalWins + totalLosses + totalDraws;
    const overallWinRate = (totalWins + totalLosses) > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : null;

    const aggregatedDonut: { name: string; total: number; winRate: number | null }[] = [];
    const otherBreakdown: { name: string; total: number; winRate: number | null }[] = [];
    let otherWins = 0, otherLosses = 0, otherTotal = 0;
    for (const o of stats.opponentDeckStats) {
      const cat = categoryMap.get(o.deckName) ?? "other";
      if (cat === "major" || cat === "minor") {
        aggregatedDonut.push({ name: o.deckName, total: o.total, winRate: o.winRate });
      } else {
        otherWins += o.wins;
        otherLosses += o.losses;
        otherTotal += o.total;
        otherBreakdown.push({ name: o.deckName, total: o.total, winRate: o.winRate });
      }
    }
    if (otherTotal > 0) {
      const otherWinRate = (otherWins + otherLosses) > 0 ? Math.round((otherWins / (otherWins + otherLosses)) * 100) : null;
      aggregatedDonut.push({ name: "その他", total: otherTotal, winRate: otherWinRate });
    }

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
              game={game}
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
            game={game}
          />
        </div>
        <div>
          <h2 className="text-base font-bold mb-2">使用デッキ別</h2>
          <MyDeckStatsSection stats={stats.myDeckStats} disableLinks game={game} />
        </div>
        <div>
          <h2 className="text-base font-bold mb-2">対面デッキ別</h2>
          <OpponentDeckStatsSection stats={stats.opponentDeckStats} disableLinks game={game} />
        </div>
      </>
    );
  };

  const renderTrend = () => (
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
        ? <TrendChart data={filteredTrendData} />
        : <TrendHeatmap data={filteredTrendData} />
      }
    </>
  );

  return (
    <div className="space-y-4">
      <DateRangeCalendar
        startDate={startDate}
        endDate={endDate}
        onRangeChange={handleRangeChange}
        battleCounts={battleCounts}
        onMonthChange={loadCounts}
      />
      <ViewSelector view={view} setView={setView} />

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        view === "stats" ? renderStats() : renderTrend()
      )}
    </div>
  );
}
