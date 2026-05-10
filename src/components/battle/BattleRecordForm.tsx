"use client";

import { useState, useEffect } from "react";
import { recordBattle, getMiniStats, getAllBattles, getOpponentMemoSuggestions, deleteOpponentMemoSuggestion } from "@/lib/actions/battle-actions";
import { useGame } from "@/lib/games/context";
import { MemoSuggestionButton } from "./MemoSuggestionButton";
import { OpponentDeckSelector } from "./OpponentDeckSelector";
import { BattleIntervalModal } from "./BattleIntervalModal";
import { MiniStats } from "../stats/MiniStats";
import { Surface } from "@/components/ui/Surface";
import { Button } from "@/components/ui/Button";
import { supportsDraw, type BattleResult } from "@/lib/battle/result-format";

import type { Format } from "@/hooks/use-format";
import type { OpponentDeckNameMap } from "@/lib/actions/opponent-deck-display";

type Tuning = { id: string; name: string; sort_order: number };
type Deck = {
  id: string;
  name: string;
  deck_tunings?: Tuning[];
};

type MiniStatsData = {
  wins: number;
  losses: number;
  draws: number;
  total: number;
  streak: number;
};

type BattleForModal = {
  id: string;
  opponent_deck_name: string;
  result: string;
  fought_at: string;
  my_deck_name: string;
};

type Props = {
  decks: Deck[];
  suggestions: { major: string[]; minor: string[]; other: string[] };
  miniStats: MiniStatsData | null;
  format: Format;
  setFormat: (f: Format) => void;
  opponentDeckNameMap?: OpponentDeckNameMap;
  onBattleRecorded?: () => void;
};

function parseDeckSelection(value: string): { deckId: string; tuningId: string | null } {
  const parts = value.split(":");
  return { deckId: parts[0], tuningId: parts[1] ?? null };
}

const MemoIcon = ({ active, hasMemo }: { active: boolean; hasMemo: boolean }) => {
  const stroke = hasMemo ? "var(--primary)" : "var(--muted-foreground)";
  const strokeOpacity = hasMemo || active ? 1 : 0.5;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke={stroke}
      strokeOpacity={strokeOpacity}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
};

export function BattleRecordForm({
  decks,
  suggestions,
  miniStats: initialMiniStats,
  format,
  opponentDeckNameMap,
  onBattleRecorded,
}: Props) {
  const { slug: game } = useGame();
  const [selectedValue, setSelectedValue] = useState<string>("");
  const [opponentDeck, setOpponentDeck] = useState("");
  const [opponentMemo, setOpponentMemo] = useState("");
  const [memoSuggestions, setMemoSuggestions] = useState<string[]>([]);
  const [showMemo, setShowMemo] = useState(false);
  const [turnOrder, setTurnOrder] = useState<"first" | "second" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<BattleResult | null>(null);
  const [miniStats, setMiniStats] = useState<MiniStatsData | null>(initialMiniStats);

  const [measureSince, setMeasureSince] = useState<string | null>(null);
  const [showIntervalModal, setShowIntervalModal] = useState(false);
  const [modalBattles, setModalBattles] = useState<BattleForModal[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(`measureSince_${format}`);
    setMeasureSince(saved);
  }, [format]);

  useEffect(() => {
    if (measureSince !== null) {
      getMiniStats(format, measureSince, game).then(setMiniStats);
    }
  }, [measureSince, format, game]);

  useEffect(() => {
    const saved = localStorage.getItem(`measureSince_${format}`);
    if (!saved) {
      setMiniStats(initialMiniStats);
    }
  }, [initialMiniStats, format]);

  useEffect(() => {
    const saved = localStorage.getItem(`selectedDeckSelection_${format}`);
    if (saved) {
      const { deckId, tuningId } = parseDeckSelection(saved);
      const deck = decks.find(d => d.id === deckId);
      if (deck) {
        if (!tuningId || deck.deck_tunings?.some(t => t.id === tuningId)) {
          setSelectedValue(saved);
          return;
        }
        setSelectedValue(deckId);
        return;
      }
    }
    if (decks.length > 0) {
      setSelectedValue(decks[0].id);
    } else {
      setSelectedValue("");
    }
  }, [decks, format]);

  useEffect(() => {
    if (selectedValue) {
      localStorage.setItem(`selectedDeckSelection_${format}`, selectedValue);
    }
  }, [selectedValue, format]);

  useEffect(() => {
    if (opponentDeck.trim()) {
      getOpponentMemoSuggestions(opponentDeck.trim(), game).then(setMemoSuggestions);
    } else {
      setMemoSuggestions([]);
      setShowMemo(false);
      setOpponentMemo("");
    }
  }, [opponentDeck, game]);

  const handleSubmit = async (result: BattleResult) => {
    const { deckId, tuningId } = parseDeckSelection(selectedValue);
    if (!deckId || !opponentDeck.trim()) return;
    setSubmitting(true);
    try {
      await recordBattle({
        game,
        myDeckId: deckId,
        myDeckName: deckNameMap.get(deckId) ?? "",
        opponentDeckName: opponentDeck.trim(),
        result,
        turnOrder,
        format,
        tuningId,
        tuningName: tuningId ? tuningNameMap.get(tuningId) ?? null : null,
        opponentMemo: opponentMemo.trim() || null,
      });
      setLastResult(result);
      setOpponentDeck("");
      setOpponentMemo("");
      setMemoSuggestions([]);
      setShowMemo(false);
      setTurnOrder(null);
      setTimeout(() => setLastResult(null), 1500);
      const updatedStats = await getMiniStats(format, measureSince ?? undefined, game);
      setMiniStats(updatedStats);
      onBattleRecorded?.();
    } catch (e) {
      console.error(e);
      alert("記録の保存に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenIntervalModal = async () => {
    const battles = await getAllBattles(format, game);
    setModalBattles(battles);
    setShowIntervalModal(true);
  };

  const handleSelectInterval = (timestamp: string | null) => {
    if (timestamp === null) {
      localStorage.removeItem(`measureSince_${format}`);
      setMeasureSince(null);
      getMiniStats(format, undefined, game).then(setMiniStats);
    } else {
      localStorage.setItem(`measureSince_${format}`, timestamp);
      setMeasureSince(timestamp);
    }
  };

  const deckNameMap = new Map<string, string>();
  const tuningNameMap = new Map<string, string>();
  for (const deck of decks) {
    deckNameMap.set(deck.id, deck.name);
    for (const t of (deck.deck_tunings ?? [])) {
      tuningNameMap.set(t.id, t.name);
    }
  }

  const deckOptions: { value: string; label: string }[] = [];
  for (const deck of decks) {
    const tunings = deck.deck_tunings ?? [];
    if (tunings.length === 0) {
      deckOptions.push({ value: deck.id, label: deck.name });
    } else {
      deckOptions.push({ value: deck.id, label: `${deck.name}(指定なし)` });
      for (const t of tunings) {
        deckOptions.push({ value: `${deck.id}:${t.id}`, label: `${deck.name} / ${t.name}` });
      }
    }
  }

  const hasMemo = opponentMemo.trim().length > 0;
  const deckSelected = opponentDeck.trim().length > 0;

  const memoHeaderExtra = (
    <button
      type="button"
      onClick={() => { if (deckSelected) setShowMemo(prev => !prev); }}
      className={`flex items-center gap-1 px-2 py-[3px] rounded-md transition-all ${
        showMemo ? "bg-primary/10 border border-primary/30" : "border border-transparent"
      } ${deckSelected ? "cursor-pointer" : "cursor-default opacity-35"}`}
    >
      <MemoIcon active={showMemo} hasMemo={hasMemo} />
      <span
        className={`text-[11px] ${
          hasMemo ? "text-primary" : showMemo ? "text-muted-foreground" : "text-muted-foreground/50"
        }`}
      >
        {hasMemo ? opponentMemo.trim() : "メモ"}
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      <MiniStats
        stats={miniStats ?? { wins: 0, losses: 0, draws: 0, total: 0, streak: 0 }}
        onEditInterval={handleOpenIntervalModal}
        game={game}
      />

      <Surface>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[12px] text-muted-foreground">使用デッキ</p>
          <a
            href={`/${game}/decks`}
            className="flex items-center gap-0.5 text-[12px] text-muted-foreground hover:text-foreground"
          >
            使用デッキ管理
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>
        </div>
        <select
          value={selectedValue}
          onChange={(e) => setSelectedValue(e.target.value)}
          disabled={deckOptions.length === 0}
          className={`w-full rounded-[6px] px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary appearance-none bg-surface-1 border border-border-subtle ${
            deckOptions.length === 0 ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {deckOptions.length === 0 ? (
            <option value="" disabled>「使用デッキ管理」からデッキを登録してください</option>
          ) : (
            deckOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          )}
        </select>
      </Surface>

      <Surface>
        <OpponentDeckSelector
          majorSuggestions={suggestions.major}
          minorSuggestions={suggestions.minor}
          otherSuggestions={suggestions.other}
          value={opponentDeck}
          onChange={setOpponentDeck}
          headerExtra={memoHeaderExtra}
          nameMap={opponentDeckNameMap}
        />

        {showMemo && opponentDeck.trim() && (
          <div className="mt-2.5 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
            <input
              type="text"
              value={opponentMemo}
              onChange={(e) => setOpponentMemo(e.target.value)}
              placeholder="デッキの特徴をメモ(例: クロック入り)"
              autoFocus
              className="w-full rounded-md bg-surface-3 border border-border-subtle px-3 py-2 text-[13px] text-foreground outline-none focus:ring-2 focus:ring-primary"
            />
            {memoSuggestions.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] text-muted-foreground mb-1.5">過去のメモ</p>
                <div className="flex flex-wrap gap-1.5">
                  {memoSuggestions.map((s) => (
                    <MemoSuggestionButton
                      key={s}
                      memo={s}
                      isSelected={opponentMemo === s}
                      onSelect={setOpponentMemo}
                      onDelete={async (memo) => {
                        await deleteOpponentMemoSuggestion(opponentDeck.trim(), memo, game);
                        setMemoSuggestions(prev => prev.filter(m => m !== memo));
                        if (opponentMemo === memo) setOpponentMemo("");
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Surface>

      <Surface>
        <p className="text-[12px] text-muted-foreground mb-2">先攻/後攻(任意)</p>
        <div className="flex gap-2">
          {(["first", "second"] as const).map((order) => {
            const isActive = turnOrder === order;
            return (
              <button
                key={order}
                type="button"
                onClick={() => setTurnOrder(isActive ? null : order)}
                className={`flex-1 rounded-[6px] px-3 py-2 text-[13px] transition-colors min-h-[44px] ${
                  isActive
                    ? "bg-primary/10 border border-primary text-primary"
                    : "bg-surface-2 border border-border-subtle text-muted-foreground"
                }`}
              >
                {order === "first" ? "先攻" : "後攻"}
              </button>
            );
          })}
        </div>

        <p className="text-[12px] text-muted-foreground mb-2 mt-3">勝敗</p>
        <div className="flex gap-2">
          <Button
            variant="result"
            tone="win"
            size="lg"
            onClick={() => handleSubmit("win")}
            disabled={submitting || !opponentDeck.trim() || !selectedValue}
            className={`flex-1 text-[15px] font-bold min-h-[48px] ${lastResult === "win" ? "scale-95 opacity-90" : ""}`}
          >
            WIN
          </Button>
          {supportsDraw(game) && (
            <Button
              variant="result"
              tone="draw"
              size="lg"
              onClick={() => handleSubmit("draw")}
              disabled={submitting || !opponentDeck.trim() || !selectedValue}
              className={`flex-1 text-[15px] font-bold min-h-[48px] ${lastResult === "draw" ? "scale-95 opacity-90" : ""}`}
            >
              DRAW
            </Button>
          )}
          <Button
            variant="result"
            tone="loss"
            size="lg"
            onClick={() => handleSubmit("loss")}
            disabled={submitting || !opponentDeck.trim() || !selectedValue}
            className={`flex-1 text-[15px] font-bold min-h-[48px] ${lastResult === "loss" ? "scale-95 opacity-90" : ""}`}
          >
            LOSE
          </Button>
        </div>
      </Surface>

      <BattleIntervalModal
        open={showIntervalModal}
        onClose={() => setShowIntervalModal(false)}
        battles={modalBattles}
        onSelect={handleSelectInterval}
        currentTimestamp={measureSince}
        opponentDeckNameMap={opponentDeckNameMap}
      />
    </div>
  );
}
