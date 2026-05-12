"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useEmblaCarousel from "embla-carousel-react";
import { FormatSelector } from "@/components/ui/FormatSelector";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/Button";
import { BattleRecordForm } from "@/components/battle/BattleRecordForm";
import { DateRangeCalendar } from "@/components/battle/DateRangeCalendar";
import { DeckFilter } from "@/components/battle/DeckFilter";
import { BattleHistoryList } from "@/components/battle/BattleHistoryList";
import type { Format } from "@/hooks/use-format";
import type { OpponentDeckNameMap } from "@/lib/actions/opponent-deck-display";

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

type TabKey = "input" | "history";

type Props = {
  format: Format;
  setFormat: (f: Format) => void;
  ready: boolean;

  // input slide
  decks: Deck[];
  suggestions: Suggestions;
  miniStats: MiniStatsData | null;
  isAdmin: boolean;

  // history slide
  battles: Battle[];
  selectedDeck: string | null;
  setSelectedDeck: (d: string | null) => void;
  startDate: string;
  endDate: string;
  onRangeChange: (start: string, end: string) => void;
  battleCounts: Record<string, number>;
  onMonthChange: (year: number, month: number) => void;
  hasAny: boolean | null;
  historyLoading: boolean;
  onHistoryRefresh: () => void;

  opponentDeckNameMap?: OpponentDeckNameMap;

  // PR8: cursor-based pagination
  hasMore?: boolean;
  loadMoreLoading?: boolean;
  onLoadMore?: () => void;
};

function readInitialTab(sp: URLSearchParams | null): TabKey {
  return sp?.get("tab") === "history" ? "history" : "input";
}

export function BattleTabsView(props: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlTab = readInitialTab(searchParams);

  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: "start",
    containScroll: "trimSnaps",
    startIndex: urlTab === "history" ? 1 : 0,
    watchDrag: (_, event) => {
      const target = event.target as Element | null;
      if (!target) return true;
      if (
        target.closest(
          "input, textarea, select, button, [contenteditable='true']"
        )
      ) {
        return false;
      }
      return true;
    },
  });

  const [currentSlide, setCurrentSlide] = useState<TabKey>(urlTab);
  const lastSyncedTabRef = useRef<TabKey>(urlTab);
  const [toast, setToast] = useState<string | null>(null);

  // embla -> URL
  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => {
      const idx = emblaApi.selectedScrollSnap();
      const next: TabKey = idx === 0 ? "input" : "history";
      setCurrentSlide(next);
      if (lastSyncedTabRef.current === next) return;
      lastSyncedTabRef.current = next;
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (next === "input") {
        params.delete("tab");
      } else {
        params.set("tab", "history");
      }
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    };
    emblaApi.on("select", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, router, searchParams]);

  // URL -> embla
  useEffect(() => {
    if (!emblaApi) return;
    const targetIdx = urlTab === "history" ? 1 : 0;
    if (emblaApi.selectedScrollSnap() !== targetIdx) {
      lastSyncedTabRef.current = urlTab;
      emblaApi.scrollTo(targetIdx);
    }
  }, [urlTab, emblaApi]);

  const switchTo = useCallback(
    (next: TabKey) => {
      if (!emblaApi) return;
      emblaApi.scrollTo(next === "input" ? 0 : 1);
    },
    [emblaApi]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "End") {
      e.preventDefault();
      switchTo("history");
    } else if (e.key === "ArrowLeft" || e.key === "Home") {
      e.preventDefault();
      switchTo("input");
    }
  };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    const id = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(id);
  }, []);

  const handleBattleRecorded = useCallback(() => {
    showToast("対戦を記録しました");
    props.onHistoryRefresh();
  }, [showToast, props]);

  const deckNames = useMemo(() => {
    const names = new Set<string>();
    for (const b of props.battles) {
      if (b.my_deck_name) names.add(b.my_deck_name);
    }
    return Array.from(names);
  }, [props.battles]);

  const filteredBattles = useMemo(() => {
    if (!props.selectedDeck) return props.battles;
    return props.battles.filter((b) => b.my_deck_name === props.selectedDeck);
  }, [props.battles, props.selectedDeck]);

  const { format, setFormat, ready } = props;
  const tabs: { key: TabKey; label: string }[] = [
    { key: "input", label: "入力" },
    { key: "history", label: "履歴" },
  ];

  return (
    <>
      <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[20px] font-medium">対戦記録</h1>
          <div className={"flex items-center gap-2" + (!ready ? " invisible" : "")}>
            {props.isAdmin && (
              <a
                href="/admin/opponent-decks"
                className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-[6px] transition-colors bg-surface-1 border border-border-subtle"
              >
                対面デッキ管理
              </a>
            )}
            <FormatSelector format={format} setFormat={setFormat} />
          </div>
        </div>

        <SegmentedControl<TabKey>
          items={tabs.map(({ key, label }) => ({
            value: key,
            label,
            ariaControls: `battle-panel-${key}`,
          }))}
          value={currentSlide}
          onChange={switchTo}
          size="md"
          variant="filled"
          fullWidth
          role="tablist"
          ariaLabel="対戦記録ビュー"
          itemIdPrefix="battle"
          onKeyDown={handleKeyDown}
          className="mb-4"
        />

        <div className="overflow-hidden" ref={emblaRef}>
          <div className="flex">
            <div
              className={`flex-[0_0_100%] min-w-0 ${currentSlide === "input" ? "" : "h-0 overflow-hidden"}`}
              role="tabpanel"
              id="battle-panel-input"
              aria-labelledby="battle-tab-input"
              aria-hidden={currentSlide !== "input"}
            >
              <BattleRecordForm
                decks={props.decks}
                suggestions={props.suggestions}
                miniStats={props.miniStats}
                format={format}
                setFormat={setFormat}
                opponentDeckNameMap={props.opponentDeckNameMap}
                onBattleRecorded={handleBattleRecorded}
              />
            </div>

            <div
              className={`flex-[0_0_100%] min-w-0 space-y-4 ${currentSlide === "history" ? "" : "h-0 overflow-hidden"}`}
              role="tabpanel"
              id="battle-panel-history"
              aria-labelledby="battle-tab-history"
              aria-hidden={currentSlide !== "history"}
            >
              {props.historyLoading ? (
                <div className="space-y-3">
                  <div className="animate-pulse rounded-[10px] bg-surface-2 h-10" />
                  <div className="animate-pulse rounded-[10px] bg-surface-2 h-[280px]" />
                  <div className="animate-pulse rounded-[10px] bg-surface-2 h-[52px]" />
                  <div className="animate-pulse rounded-[10px] bg-surface-2 h-[52px]" />
                  <div className="animate-pulse rounded-[10px] bg-surface-2 h-[52px]" />
                  <div className="animate-pulse rounded-[10px] bg-surface-2 h-[52px]" />
                </div>
              ) : props.hasAny === false ? (
                <div className="rounded-[12px] p-6 text-center space-y-4 bg-surface-1 border border-border-subtle">
                  <div className="space-y-2">
                    <h2 className="text-[18px] font-medium">まだ対戦記録がありません</h2>
                    <p className="text-sm text-muted-foreground">最初の対戦を記録してみましょう。</p>
                  </div>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => switchTo("input")}
                  >
                    対戦を記録する
                  </Button>
                </div>
              ) : (
                <>
                  <DateRangeCalendar
                    startDate={props.startDate}
                    endDate={props.endDate}
                    onRangeChange={props.onRangeChange}
                    battleCounts={props.battleCounts}
                    onMonthChange={props.onMonthChange}
                  />
                  {deckNames.length > 0 && (
                    <DeckFilter
                      deckNames={deckNames}
                      selectedDeck={props.selectedDeck}
                      onSelect={props.setSelectedDeck}
                    />
                  )}
                  <BattleHistoryList
                    battles={filteredBattles}
                    decks={props.decks}
                    suggestions={props.suggestions}
                    onRefresh={props.onHistoryRefresh}
                    opponentDeckNameMap={props.opponentDeckNameMap}
                    hasMore={props.hasMore}
                    loadMoreLoading={props.loadMoreLoading}
                    onLoadMore={props.onLoadMore}
                    deckFilterActive={props.selectedDeck != null}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-center mt-4 gap-2" aria-hidden="true">
          {tabs.map(({ key }) => (
            <span
              key={key}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                currentSlide === key ? "bg-primary" : "bg-muted-foreground/40"
              }`}
            />
          ))}
        </div>
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 bottom-[72px] z-50 rounded-[10px] px-4 py-2 text-sm font-medium bg-primary text-primary-foreground shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
