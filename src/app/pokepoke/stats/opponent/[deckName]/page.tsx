"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { getOpponentDeckDetailStats, getGlobalOpponentDeckDetailStats, getTeamOpponentDeckDetailStats } from "@/lib/actions/stats-actions";
import type { OpponentDeckDetailStats } from "@/lib/actions/stats-actions";
import { getDailyBattleCounts } from "@/lib/actions/battle-actions";
import { getOpponentDeckNameMap, displayDeckName, type OpponentDeckNameMap } from "@/lib/actions/opponent-deck-display";
import { useFormat } from "@/hooks/use-format";
import { useDateRange } from "@/hooks/use-date-range";
import { FormatSelector } from "@/components/ui/FormatSelector";
import { DateRangeCalendar } from "@/components/battle/DateRangeCalendar";
import { MatchupCard } from "@/components/stats/MatchupCard";
import { MatchupTable } from "@/components/stats/MatchupTable";
import { EncounterDonutChart } from "@/components/stats/EncounterDonutChart";
import { TurnOrderCards } from "@/components/stats/TurnOrderCards";
import { BottomNav } from "@/components/layout/BottomNav";
import { PageShell } from "@/components/ui/PageShell";
import { ShareButton } from "@/components/share/ShareButton";
import type { DeckShareData } from "@/components/share/ShareButton";

export default function OpponentDeckDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { format, setFormat, ready } = useFormat();

  const deckName = decodeURIComponent(params.deckName as string);
  const scope = searchParams.get("scope") ?? "personal";
  const isGlobal = scope === "global";
  const isTeam = scope === "team";
  const teamId = searchParams.get("teamId");
  const memberId = searchParams.get("memberId");
  const memberName = searchParams.get("memberName");
  const premiumFilter = searchParams.get("premium") === "1";

  const [stats, setStats] = useState<OpponentDeckDetailStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [opponentDeckNameMap, setOpponentDeckNameMap] = useState<OpponentDeckNameMap>({});
  const [nameMapFormat, setNameMapFormat] = useState<string | null>(null);
  const nameMapReady = nameMapFormat === format;
  const [battleCounts, setBattleCounts] = useState<Record<string, number>>({});
  const [sortBy, setSortBy] = useState<"count" | "winRate">("count");
  const [viewMode, setViewMode] = useState<"visual" | "table">("visual");

  // useDateRange: URL `?start=` > localStorage (ゲーム別) > default (1ヶ月前)。
  const { startDate, endDate, setStartDate, setEndDate } = useDateRange();

  const loadStats = useCallback(() => {
    if (!ready) return;
    setLoading(true);
    let promise: Promise<OpponentDeckDetailStats>;
    const maxStage = premiumFilter ? 1 : undefined;
    if (isTeam && teamId) {
      promise = getTeamOpponentDeckDetailStats(teamId, memberId, deckName, format, startDate, endDate);
    } else if (isGlobal) {
      promise = getGlobalOpponentDeckDetailStats(deckName, format, startDate, endDate, maxStage);
    } else {
      promise = getOpponentDeckDetailStats(deckName, format, startDate, endDate);
    }
    promise.then((s) => {
      setStats(s);
      setLoading(false);
    });
  }, [deckName, format, startDate, endDate, ready, isGlobal, isTeam, teamId, memberId, premiumFilter]);

  const loadCounts = useCallback((year: number, month: number) => {
    if (!ready) return;
    getDailyBattleCounts(format, year, month, "pokepoke").then(setBattleCounts);
  }, [format, ready]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getOpponentDeckNameMap(format, "pokepoke").then((map) => {
      if (cancelled) return;
      setOpponentDeckNameMap(map);
      setNameMapFormat(format);
    });
    return () => { cancelled = true; };
  }, [format, ready]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    const now = new Date();
    loadCounts(now.getFullYear(), now.getMonth() + 1);
  }, [loadCounts]);

  const sortedOverall = useMemo(() => {
    if (!stats) return [];
    const arr = [...stats.overall];
    if (sortBy === "winRate") {
      arr.sort((a, b) => (b.winRate ?? -1) - (a.winRate ?? -1) || b.total - a.total);
    } else {
      arr.sort((a, b) => b.total - a.total);
    }
    return arr;
  }, [stats, sortBy]);

  const donutItems = useMemo(() => {
    if (!stats) return [];
    return stats.overall.map((o) => ({ name: o.myDeckName, total: o.total, winRate: o.winRate }));
  }, [stats]);

  const handleRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const titleSuffix = isTeam
    ? memberId && memberName ? `（${memberName}）` : "（サーバー全体）"
    : isGlobal ? "（全体）" : "";

  const backScope = isTeam ? "team" : isGlobal ? "global" : "personal";

  return (
    <>
      <PageShell>
        <button
          onClick={() => {
            const p = new URLSearchParams();
            p.set("scope", backScope);
            p.set("start", startDate);
            p.set("end", endDate);
            router.push("/pokepoke/stats?" + p.toString());
          }}
          className="text-sm text-primary hover:underline flex items-center gap-1"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          統計に戻る
        </button>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{`vs ${displayDeckName(deckName, opponentDeckNameMap)}${titleSuffix}`}</h1>
            {scope === "personal" && stats && stats.overallTotal > 0 && nameMapReady && (() => {
              const fW = stats.overall.reduce((s, o) => s + o.firstWins, 0);
              const fL = stats.overall.reduce((s, o) => s + o.firstLosses, 0);
              const fD = stats.overall.reduce((s, o) => s + o.firstDraws, 0);
              const sW = stats.overall.reduce((s, o) => s + o.secondWins, 0);
              const sL = stats.overall.reduce((s, o) => s + o.secondLosses, 0);
              const sD = stats.overall.reduce((s, o) => s + o.secondDraws, 0);
              const shareData: DeckShareData = {
                deckName: displayDeckName(deckName, opponentDeckNameMap),
                totalWins: stats.overallWins,
                totalLosses: stats.overallLosses,
                totalDraws: stats.overallDraws,
                winRate: stats.overallWinRate,
                firstWins: fW, firstLosses: fL, firstDraws: fD,
                secondWins: sW, secondLosses: sL, secondDraws: sD,
                topMatchups: stats.overall.slice(0, 5).map(o => ({ name: o.myDeckName, wins: o.wins, losses: o.losses, draws: o.draws, winRate: o.winRate })),
                period: `${startDate} ~ ${endDate}`,
                format,
                game: "pokepoke",
              };
              return <ShareButton type="opponent" data={shareData} />;
            })()}
          </div>
          <div className={!ready ? "invisible" : ""}>
            <FormatSelector format={format} setFormat={setFormat} />
          </div>
        </div>

        {(!ready || loading) ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : stats && (
          <>
            <DateRangeCalendar
              startDate={startDate}
              endDate={endDate}
              onRangeChange={handleRangeChange}
              battleCounts={battleCounts}
              onMonthChange={loadCounts}
            />

            <div className="space-y-3">
              <h2 className="text-base font-bold">全体</h2>

              {stats.overall.length === 0 ? (
                <p className="text-center text-muted-foreground py-4 text-sm">データがありません</p>
              ) : (
                <>
                  <EncounterDonutChart
                    items={donutItems}
                    overallWinRate={stats.overallWinRate}
                    overallWins={stats.overallWins}
                    overallLosses={stats.overallLosses}
                    overallDraws={stats.overallDraws}
                    overallTotal={stats.overallTotal}
                    game="pokepoke"
                  />

                  {(() => {
                    const fw = stats.overall.reduce((s, o) => s + o.firstWins, 0);
                    const fl = stats.overall.reduce((s, o) => s + o.firstLosses, 0);
                    const fd = stats.overall.reduce((s, o) => s + o.firstDraws, 0);
                    const sw = stats.overall.reduce((s, o) => s + o.secondWins, 0);
                    const sl = stats.overall.reduce((s, o) => s + o.secondLosses, 0);
                    const sd = stats.overall.reduce((s, o) => s + o.secondDraws, 0);
                    const uw = stats.overall.reduce((s, o) => s + o.unknownWins, 0);
                    const ul = stats.overall.reduce((s, o) => s + o.unknownLosses, 0);
                    const ud = stats.overall.reduce((s, o) => s + o.unknownDraws, 0);
                    return (
                      <div>
                        <h2 className="text-base font-bold mb-2">先攻/後攻別</h2>
                        <TurnOrderCards
                          firstWins={fw} firstLosses={fl} firstDraws={fd} firstTotal={fw + fl + fd}
                          secondWins={sw} secondLosses={sl} secondDraws={sd} secondTotal={sw + sl + sd}
                          unknownWins={uw} unknownLosses={ul} unknownDraws={ud} unknownTotal={uw + ul + ud}
                          game="pokepoke"
                        />
                      </div>
                    );
                  })()}

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 500 }}>表示形式</span>
                      <div className="flex rounded-full border border-border overflow-hidden">
                        <button
                          onClick={() => setViewMode("visual")}
                          className={`px-3 py-1 text-xs font-medium ${viewMode === "visual" ? "bg-primary text-primary-foreground" : ""}`}
                        >
                          視覚的
                        </button>
                        <button
                          onClick={() => setViewMode("table")}
                          className={`px-3 py-1 text-xs font-medium ${viewMode === "table" ? "bg-primary text-primary-foreground" : ""}`}
                        >
                          表形式
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">並び替え:</span>
                      <button
                        onClick={() => setSortBy("count")}
                        className={`px-2 py-0.5 rounded ${sortBy === "count" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        対戦数
                      </button>
                      <button
                        onClick={() => setSortBy("winRate")}
                        className={`px-2 py-0.5 rounded ${sortBy === "winRate" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      >
                        勝率
                      </button>
                    </div>
                  </div>

                  {viewMode === "visual" ? (
                    <div className="space-y-2">
                      {sortedOverall.map((row) => (
                        <MatchupCard key={row.myDeckName} name={row.myDeckName} detail={row} game="pokepoke" />
                      ))}
                    </div>
                  ) : (
                    <MatchupTable
                      rows={sortedOverall.map((row) => ({ ...row, name: row.myDeckName }))}
                      showTotal
                      game="pokepoke"
                    />
                  )}
                </>
              )}
            </div>
          </>
        )}
      </PageShell>
      <BottomNav />
    </>
  );
}
