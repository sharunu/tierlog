"use client";

import { useEffect, useState, useCallback } from "react";
import { getAdminUserBattles, getAdminUserDailyBattleCounts } from "@/lib/actions/admin-actions";
import { DateRangeCalendar } from "@/components/battle/DateRangeCalendar";
import { DeckFilter } from "@/components/battle/DeckFilter";
import { BattleHistoryList } from "@/components/battle/BattleHistoryList";
import { DEFAULT_GAME, type GameSlug } from "@/lib/games";

type Props = {
  userId: string;
  format: string;
  game?: GameSlug;
};

export function AdminUserBattles({ userId, format, game = DEFAULT_GAME }: Props) {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString("sv-SE");
  });
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [battles, setBattles] = useState<ReturnType<typeof getAdminUserBattles> extends Promise<infer T> ? T : never>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [battleCounts, setBattleCounts] = useState<Record<string, number>>({});
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);

  const loadBattles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminUserBattles(userId, format, startDate, endDate, game);
      setBattles(data);
    } catch {
      setError("データの読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [userId, format, startDate, endDate, game]);

  const loadCounts = useCallback((year: number, month: number) => {
    getAdminUserDailyBattleCounts(userId, format, year, month, game).then(setBattleCounts).catch(() => {});
  }, [userId, format, game]);

  useEffect(() => {
    // loadBattles は useCallback ラップ済で内部で setState 経由 fetch 反映。
    // 外部状態 (userId/format/startDate/endDate/game) 変化時の effect 内呼び出し。

    loadBattles();
  }, [loadBattles]);

  useEffect(() => {
    const now = new Date();
    loadCounts(now.getFullYear(), now.getMonth() + 1);
  }, [loadCounts]);

  const handleRangeChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
  };

  const deckNames = [...new Set(battles.map((b) => b.my_deck_name))].filter(Boolean) as string[];
  const filteredBattles = selectedDeck
    ? battles.filter((b) => b.my_deck_name === selectedDeck)
    : battles;

  return (
    <div className="space-y-4">
      <DateRangeCalendar
        startDate={startDate}
        endDate={endDate}
        onRangeChange={handleRangeChange}
        battleCounts={battleCounts}
        onMonthChange={loadCounts}
      />

      {deckNames.length > 1 && (
        <DeckFilter
          deckNames={deckNames}
          selectedDeck={selectedDeck}
          onSelect={setSelectedDeck}
        />
      )}

      {error ? (
        <p className="text-center text-destructive py-12 text-sm">{error}</p>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <BattleHistoryList
          battles={filteredBattles as Parameters<typeof BattleHistoryList>[0]["battles"]}
          decks={[]}
          suggestions={{ major: [], minor: [], other: [] }}
          readOnly
        />
      )}
    </div>
  );
}
