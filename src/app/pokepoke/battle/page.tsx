"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { getDecks } from "@/lib/actions/deck-actions";
import {
  getBattlesByDateRangePaginated,
  getDailyBattleCounts,
  getOpponentDeckSuggestions,
  getMiniStats,
  hasAnyBattles,
  type BattleListCursor,
} from "@/lib/actions/battle-actions";
import { checkIsAdmin } from "@/lib/actions/admin-actions";
import {
  getOpponentDeckNameMap,
  type OpponentDeckNameMap,
} from "@/lib/actions/opponent-deck-display";
import { useFormat } from "@/hooks/use-format";
import { useDateRange } from "@/hooks/use-date-range";
import { BottomNav } from "@/components/layout/BottomNav";
import { BattleTabsView } from "@/components/battle/BattleTabsView";

type Tuning = { id: string; name: string; sort_order: number };
type Deck = { id: string; name: string; deck_tunings?: Tuning[] };
type Battle = {
  id: string;
  my_deck_id: string;
  my_deck_name: string;
  opponent_deck_name: string;
  result: "win" | "loss" | "draw";
  turn_order: "first" | "second" | null;
  fought_at: string;
  tuning_id: string | null;
  tuning_name?: string | null;
};

type Suggestions = { major: string[]; minor: string[]; other: string[] };
type MiniStatsData = {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  streak: number;
};

function BattlePageInner() {
  const { format, setFormat, ready } = useFormat();

  const [decks, setDecks] = useState<Deck[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>({
    major: [],
    minor: [],
    other: [],
  });
  const [miniStats, setMiniStats] = useState<MiniStatsData | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [nameMap, setNameMap] = useState<OpponentDeckNameMap>({});
  const [inputLoading, setInputLoading] = useState(true);

  const [battles, setBattles] = useState<Battle[]>([]);
  // PR8: cursor-based pagination (50 件/ページ)
  const [cursor, setCursor] = useState<BattleListCursor | null>(null);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState<boolean>(false);
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [battleCounts, setBattleCounts] = useState<Record<string, number>>({});
  const [hasAny, setHasAny] = useState<boolean | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [error, setError] = useState<string | null>(null);

  // useDateRange: URL `?start=` > localStorage (ゲーム別) > default (1ヶ月前)。
  // battle/page.tsx は従来 URL params 非対応だったが、本改修で stats と同じく URL 連携を追加。
  const { startDate, endDate, setStartDate, setEndDate } = useDateRange();

  const loadInputData = useCallback(() => {
    if (!ready) return;
    Promise.all([
      getDecks(format, "pokepoke"),
      getOpponentDeckSuggestions(format, "pokepoke"),
      getMiniStats(
        format,
        localStorage.getItem(`measureSince_${format}`) ?? undefined,
        "pokepoke"
      ),
      checkIsAdmin(),
      getOpponentDeckNameMap(format, "pokepoke"),
    ])
      .then(([d, s, m, admin, map]) => {
        setDecks(d as Deck[]);
        setSuggestions(s);
        setMiniStats(m);
        setIsAdmin(admin);
        setNameMap(map);
        setInputLoading(false);
      })
      .catch(() => {
        setError("データの読み込みに失敗しました");
        setInputLoading(false);
      });
  }, [format, ready]);

  const loadHistory = useCallback(() => {
    if (!ready) return;
    setHistoryLoading(true);
    Promise.all([
      getBattlesByDateRangePaginated(format, startDate, endDate, null, 50, "pokepoke"),
      hasAnyBattles(format, "pokepoke"),
      getOpponentDeckNameMap(format, "pokepoke"),
    ])
      .then(([result, any, map]) => {
        setBattles(result.rows as unknown as Battle[]);
        setCursor(result.nextCursor);
        setHasMore(result.hasMore);
        setHasAny(any);
        setNameMap(map);
        setHistoryLoading(false);
      })
      .catch((e) => {
        console.error("Failed to load battles", e);
        setError("データの読み込みに失敗しました");
        setHistoryLoading(false);
      });
  }, [format, startDate, endDate, ready]);

  const loadMore = useCallback(() => {
    if (!ready || !cursor || loadMoreLoading) return;
    setLoadMoreLoading(true);
    getBattlesByDateRangePaginated(format, startDate, endDate, cursor, 50, "pokepoke")
      .then((result) => {
        setBattles((prev) => [...prev, ...(result.rows as unknown as Battle[])]);
        setCursor(result.nextCursor);
        setHasMore(result.hasMore);
        setLoadMoreLoading(false);
      })
      .catch((e) => {
        console.error("Failed to load more battles", e);
        setLoadMoreLoading(false);
      });
  }, [format, startDate, endDate, ready, cursor, loadMoreLoading]);

  const loadCounts = useCallback(
    (year: number, month: number) => {
      if (!ready) return;
      getDailyBattleCounts(format, year, month, "pokepoke").then(setBattleCounts);
    },
    [format, ready]
  );

  useEffect(() => {
    loadInputData();
  }, [loadInputData]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const now = new Date();
    loadCounts(now.getFullYear(), now.getMonth() + 1);
  }, [loadCounts]);

  useEffect(() => {
    setSelectedDeck(null);
  }, [format]);

  const handleRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const handleHistoryRefresh = useCallback(() => {
    loadHistory();
    const now = new Date();
    loadCounts(now.getFullYear(), now.getMonth() + 1);
  }, [loadHistory, loadCounts]);

  const ready2 = ready && !inputLoading;

  const content = useMemo(() => {
    if (error) {
      return <p className="text-center text-destructive py-12 text-sm">{error}</p>;
    }
    if (!ready2) {
      return (
        <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="animate-pulse rounded-[8px] bg-surface-2 h-6 w-24" />
            <div className="animate-pulse rounded-[8px] bg-surface-2 h-8 w-20" />
          </div>
          <div className="space-y-4">
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[56px]" />
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[52px]" />
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[52px]" />
            <div className="animate-pulse rounded-[10px] bg-surface-2 h-[44px]" />
            <div className="flex gap-3">
              <div className="animate-pulse rounded-[10px] bg-surface-2 h-[56px] flex-1" />
              <div className="animate-pulse rounded-[10px] bg-surface-2 h-[56px] flex-1" />
            </div>
          </div>
        </div>
      );
    }
    return (
      <BattleTabsView
        format={format}
        setFormat={setFormat}
        ready={ready}
        decks={decks}
        suggestions={suggestions}
        miniStats={miniStats}
        isAdmin={isAdmin}
        battles={battles}
        selectedDeck={selectedDeck}
        setSelectedDeck={setSelectedDeck}
        startDate={startDate}
        endDate={endDate}
        onRangeChange={handleRangeChange}
        battleCounts={battleCounts}
        onMonthChange={loadCounts}
        hasAny={hasAny}
        historyLoading={historyLoading}
        onHistoryRefresh={handleHistoryRefresh}
        opponentDeckNameMap={nameMap}
        hasMore={hasMore}
        loadMoreLoading={loadMoreLoading}
        onLoadMore={loadMore}
      />
    );
  }, [
    error,
    ready2,
    format,
    setFormat,
    ready,
    decks,
    suggestions,
    miniStats,
    isAdmin,
    battles,
    selectedDeck,
    startDate,
    endDate,
    battleCounts,
    loadCounts,
    hasAny,
    historyLoading,
    handleHistoryRefresh,
    nameMap,
    hasMore,
    loadMoreLoading,
    loadMore,
  ]);

  return (
    <>
      {content}
      <BottomNav />
    </>
  );
}

export default function BattlePage() {
  return (
    <Suspense
      fallback={
        <>
          <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="animate-pulse rounded-[8px] bg-surface-2 h-6 w-24" />
              <div className="animate-pulse rounded-[8px] bg-surface-2 h-8 w-20" />
            </div>
            <div className="space-y-4">
              <div className="animate-pulse rounded-[10px] bg-surface-2 h-[56px]" />
              <div className="animate-pulse rounded-[10px] bg-surface-2 h-[52px]" />
              <div className="animate-pulse rounded-[10px] bg-surface-2 h-[52px]" />
            </div>
          </div>
          <BottomNav />
        </>
      }
    >
      <BattlePageInner />
    </Suspense>
  );
}
