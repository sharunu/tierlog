"use client";

import { useState, useEffect } from "react";
import { recordBattle, getMiniStats, getAllBattles, getOpponentMemoSuggestions, deleteOpponentMemoSuggestion } from "@/lib/actions/battle-actions";
import { useGame } from "@/lib/games/context";
import { MemoSuggestionButton } from "./MemoSuggestionButton";
import { OpponentDeckSelector } from "./OpponentDeckSelector";
import { BattleIntervalModal } from "./BattleIntervalModal";
import { MiniStats } from "../stats/MiniStats";
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

const MemoIcon = ({ active, hasMemo }: { active: boolean; hasMemo: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
    stroke={hasMemo ? "#6366f1" : active ? "#94a3b8" : "#555577"}
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  </svg>
);

export function BattleRecordForm({
  decks,
  suggestions,
  miniStats: initialMiniStats,
  format,
  setFormat,
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

  // Measure interval state
  const [measureSince, setMeasureSince] = useState<string | null>(null);
  const [showIntervalModal, setShowIntervalModal] = useState(false);
  const [modalBattles, setModalBattles] = useState<BattleForModal[]>([]);

  // Load measureSince from localStorage on mount and format change
  useEffect(() => {
    const saved = localStorage.getItem(`measureSince_${format}`);
    setMeasureSince(saved);
  }, [format]);

  // When measureSince changes, refresh stats
  useEffect(() => {
    if (measureSince !== null) {
      getMiniStats(format, measureSince, game).then(setMiniStats);
    }
  }, [measureSince, format, game]);

  // Sync miniStats when props change (e.g. format switch) - only if no custom interval
  useEffect(() => {
    const saved = localStorage.getItem(`measureSince_${format}`);
    if (!saved) {
      setMiniStats(initialMiniStats);
    }
  }, [initialMiniStats, format]);

  // Restore selected deck from localStorage (per format)
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

  // Save selected value to localStorage (per format)
  useEffect(() => {
    if (selectedValue) {
      localStorage.setItem(`selectedDeckSelection_${format}`, selectedValue);
    }
  }, [selectedValue, format]);

  // Fetch memo suggestions when opponent deck changes
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
      deckOptions.push({ value: deck.id, label: `${deck.name}（指定なし）` });
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 6,
        background: showMemo ? "rgba(99,102,241,0.1)" : "transparent",
        border: showMemo ? "1px solid rgba(99,102,241,0.3)" : "1px solid transparent",
        cursor: deckSelected ? "pointer" : "default",
        opacity: deckSelected ? 1 : 0.35,
        transition: "all 0.15s",
      }}
    >
      <MemoIcon active={showMemo} hasMemo={hasMemo} />
      <span style={{ fontSize: 11, color: hasMemo ? "#6366f1" : showMemo ? "#94a3b8" : "#555577" }}>
        {hasMemo ? opponentMemo.trim() : "メモ"}
      </span>
    </button>
  );

  return (
    <div className="space-y-4">


          {/* Mini stats */}
          <MiniStats
            stats={miniStats ?? { wins: 0, losses: 0, draws: 0, total: 0, streak: 0 }}
            onEditInterval={handleOpenIntervalModal}
            game={game}
          />

          {/* Deck selector */}
          <div style={{ background: '#1a1d2e', border: '1px solid #2a2d48', borderRadius: 10, padding: 12 }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] text-gray-500">使用デッキ</p>
            <a
              href={`/${game}/decks`}
              className="flex items-center gap-0.5 text-[12px]"
              style={{ color: "#8888aa" }}
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
            className="w-full rounded-[6px] px-4 py-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-indigo-500 appearance-none"
            style={{ backgroundColor: "#1a1d2e", border: "0.5px solid #333355", color: deckOptions.length === 0 ? "#666688" : "#e5e7eb" }}
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
          </div>

          {/* Opponent deck + memo */}
          <div style={{ background: '#1a1d2e', border: '1px solid #2a2d48', borderRadius: 10, padding: 12 }}>
          <OpponentDeckSelector
            majorSuggestions={suggestions.major}
            minorSuggestions={suggestions.minor}
            otherSuggestions={suggestions.other}
            value={opponentDeck}
            onChange={setOpponentDeck}
            headerExtra={memoHeaderExtra}
            nameMap={opponentDeckNameMap}
          />

          {/* Memo panel — expands below opponent deck selector */}
          {showMemo && opponentDeck.trim() && (
            <div
              style={{
                marginTop: 10,
                background: "#1e2138",
                borderRadius: 10,
                border: "0.5px solid #333355",
                padding: "10px 12px",
              }}
            >
              <input
                type="text"
                value={opponentMemo}
                onChange={(e) => setOpponentMemo(e.target.value)}
                placeholder="デッキの特徴をメモ（例：クロック入り）"
                autoFocus
                style={{
                  width: "100%",
                  background: "#232640",
                  border: "0.5px solid #333355",
                  borderRadius: 6,
                  padding: "8px 12px",
                  fontSize: 13,
                  color: "#e8e8ec",
                  outline: "none",
                }}
              />
              {memoSuggestions.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 10, color: "#666688", marginBottom: 6 }}>過去のメモ</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
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

          </div>

          {/* Turn order + Result */}
          <div style={{ background: '#1a1d2e', border: '1px solid #2a2d48', borderRadius: 10, padding: 12 }}>
            <p className="text-[12px] text-gray-500 mb-2">先攻/後攻（任意）</p>
            <div className="flex gap-2">
              {(["first", "second"] as const).map((order) => (
                <button
                  key={order}
                  type="button"
                  onClick={() =>
                    setTurnOrder(turnOrder === order ? null : order)
                  }
                  className="flex-1 rounded-[6px] px-3 py-2 text-[13px] transition-colors min-h-[44px]"
                  style={
                    turnOrder === order
                      ? { backgroundColor: "rgba(99,102,241,0.1)", border: "1px solid #6366f1", color: "#818cf8" }
                      : { backgroundColor: "#232640", border: "0.5px solid rgba(100,100,150,0.2)", color: "#9ca3af" }
                  }
                >
                  {order === "first" ? "先攻" : "後攻"}
                </button>
              ))}
            </div>

            <p className="text-[12px] text-gray-500 mb-2" style={{ marginTop: 12 }}>勝敗</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleSubmit("win")}
                disabled={submitting || !opponentDeck.trim() || !selectedValue}
                className={"flex-1 rounded-[6px] px-3 py-2 text-[15px] font-bold transition-all min-h-[44px] text-white " + (
                  lastResult === "win"
                    ? "scale-95 opacity-90"
                    : "hover:brightness-110 disabled:opacity-40"
                )}
                style={{ background: "linear-gradient(to right, #22c55e, #16a34a)" }}
              >
                WIN
              </button>
              {supportsDraw(game) && (
                <button
                  onClick={() => handleSubmit("draw")}
                  disabled={submitting || !opponentDeck.trim() || !selectedValue}
                  className={"flex-1 rounded-[6px] px-3 py-2 text-[15px] font-bold transition-all min-h-[44px] text-white " + (
                    lastResult === "draw"
                      ? "scale-95 opacity-90"
                      : "hover:brightness-110 disabled:opacity-40"
                  )}
                  style={{ background: "linear-gradient(to right, #f59e0b, #d97706)" }}
                >
                  DRAW
                </button>
              )}
              <button
                onClick={() => handleSubmit("loss")}
                disabled={submitting || !opponentDeck.trim() || !selectedValue}
                className={"flex-1 rounded-[6px] px-3 py-2 text-[15px] font-bold transition-all min-h-[44px] text-white " + (
                  lastResult === "loss"
                    ? "scale-95 opacity-90"
                    : "hover:brightness-110 disabled:opacity-40"
                )}
                style={{ background: "linear-gradient(to right, #ef4444, #dc2626)" }}
              >
                LOSE
              </button>
            </div>
          </div>

          {/* Interval modal */}
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
