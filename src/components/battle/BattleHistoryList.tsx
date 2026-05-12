"use client";

import { useState } from "react";
import { Pencil, X } from "lucide-react";
import { updateBattle, deleteBattle } from "@/lib/actions/battle-actions";
import { EditBattleModal } from "./EditBattleModal";
import {
  displayDeckName,
  type OpponentDeckNameMap,
} from "@/lib/actions/opponent-deck-display";
import type { BattleResult } from "@/lib/battle/result-format";

type Tuning = { id: string; name: string; sort_order: number };
type Deck = { id: string; name: string; deck_tunings?: Tuning[] };

type Battle = {
  id: string;
  my_deck_id: string;
  my_deck_name: string;
  opponent_deck_name: string;
  opponent_memo?: string | null;
  result: BattleResult;
  turn_order: "first" | "second" | null;
  fought_at: string;
  tuning_id: string | null;
  tuning_name?: string | null;
};

type Props = {
  battles: Battle[];
  decks: Deck[];
  suggestions: { major: string[]; minor: string[]; other: string[] };
  onRefresh?: () => void;
  readOnly?: boolean;
  opponentDeckNameMap?: OpponentDeckNameMap;
  // PR8: cursor-based pagination (省略可、未指定なら「もっと読む」ボタン非表示)
  hasMore?: boolean;
  loadMoreLoading?: boolean;
  onLoadMore?: () => void;
  // deck filter が active のときは server cursor の意味が変わるため、UI 注記用フラグ
  deckFilterActive?: boolean;
};

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function groupByDate(battles: Battle[]): { date: string; battles: Battle[] }[] {
  const map = new Map<string, Battle[]>();
  for (const b of battles) {
    const d = new Date(b.fought_at);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(b);
  }
  return Array.from(map.entries()).map(([date, battles]) => ({ date, battles }));
}

export function BattleHistoryList({ battles, decks, suggestions, onRefresh, readOnly, opponentDeckNameMap, hasMore, loadMoreLoading, onLoadMore, deckFilterActive }: Props) {
  const [editingBattle, setEditingBattle] = useState<Battle | null>(null);

  if (battles.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-12">
        対戦履歴がありません
      </p>
    );
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm("この対戦記録を削除しますか?")) return;
    await deleteBattle(id);
    onRefresh?.();
  };

  const handleSave = async (fields: {
    opponentDeckName: string;
    result: BattleResult;
    turnOrder: "first" | "second" | null;
    myDeckId: string;
    myDeckName: string;
    tuningId?: string | null;
    tuningName?: string | null;
    opponentMemo?: string | null;
  }) => {
    if (!editingBattle) return;
    await updateBattle(editingBattle.id, fields);
    setEditingBattle(null);
    onRefresh?.();
  };

  const groups = groupByDate(battles);

  return (
    <>
      <div className="space-y-0">
        {groups.map((group, groupIdx) => (
          <div key={group.date}>
            <div
              className={`text-[11px] font-medium text-muted-foreground/60 ${
                groupIdx === 0 ? "pt-[4px]" : "pt-[10px]"
              } pb-[6px]`}
            >
              {group.date}
            </div>

            <div className="flex flex-col gap-[6px]">
              {group.battles.map((b) => {
                const deckDisplay = b.my_deck_name ?? "?";
                const tuningDisplay = b.tuning_name;
                const resultKey = b.result;

                const barColor =
                  resultKey === "win" ? "bg-success"
                  : resultKey === "loss" ? "bg-destructive"
                  : "bg-warning";
                const badgeColor =
                  resultKey === "win" ? "bg-success/15 text-success"
                  : resultKey === "loss" ? "bg-destructive/15 text-destructive"
                  : "bg-warning/15 text-warning";
                const badgeLabel =
                  resultKey === "win" ? "WIN"
                  : resultKey === "loss" ? "LOSE"
                  : "DRAW";

                return (
                  <div
                    key={b.id}
                    className="bg-surface-2 rounded-[10px] overflow-hidden flex"
                  >
                    <div className={`w-[3px] shrink-0 ${barColor}`} />

                    <div className="flex-1 px-3 py-2.5 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`shrink-0 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColor}`}
                        >
                          {badgeLabel}
                        </span>

                        <span className="text-[13px] font-medium text-foreground truncate">
                          {deckDisplay}
                        </span>
                        {tuningDisplay && (
                          <>
                            <span className="text-[11px] text-muted-foreground shrink-0">/</span>
                            <span className="text-[11px] text-muted-foreground truncate">
                              {tuningDisplay}
                            </span>
                          </>
                        )}
                        <span className="text-[11px] text-muted-foreground/60 shrink-0">vs</span>
                        <span className="text-[13px] text-foreground truncate">
                          {displayDeckName(b.opponent_deck_name, opponentDeckNameMap)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 mt-1">
                        {b.turn_order && (
                          <span
                            className={`text-[10px] font-medium px-1.5 py-0.5 rounded-[3px] ${
                              b.turn_order === "first"
                                ? "bg-warning/10 text-warning"
                                : "bg-primary/10 text-primary"
                            }`}
                          >
                            {b.turn_order === "first" ? "先攻" : "後攻"}
                          </span>
                        )}
                        {b.opponent_memo && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-[3px] bg-muted/30 text-muted-foreground truncate max-w-[120px]">
                            {b.opponent_memo}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground/60">
                          {formatTime(b.fought_at)}
                        </span>

                        {!readOnly && (
                          <div className="ml-auto flex gap-1.5">
                            <button
                              onClick={() => setEditingBattle(b)}
                              aria-label="編集"
                              className="relative p-2 -m-2 flex items-center justify-center"
                            >
                              <span className="w-[28px] h-[28px] flex items-center justify-center rounded-[6px] bg-primary/10 text-primary">
                                <Pencil size={13} />
                              </span>
                            </button>
                            <button
                              onClick={() => handleDelete(b.id)}
                              aria-label="削除"
                              className="relative p-2 -m-2 flex items-center justify-center"
                            >
                              <span className="w-[28px] h-[28px] flex items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
                                <X size={13} />
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {hasMore && onLoadMore && (
        <div className="flex flex-col items-center mt-4 mb-2 gap-1">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadMoreLoading}
            className="px-4 py-2 rounded-[8px] bg-primary/10 text-primary text-sm font-medium disabled:opacity-50"
          >
            {loadMoreLoading ? "読み込み中..." : "もっと読む"}
          </button>
          {deckFilterActive && (
            <span className="text-[10px] text-muted-foreground/60">
              ※ デッキ絞り込み中。さらに過去の対戦も含めて読み込みます
            </span>
          )}
        </div>
      )}

      {!readOnly && editingBattle && (
        <EditBattleModal
          battle={editingBattle}
          decks={decks}
          suggestions={suggestions}
          onSave={handleSave}
          onClose={() => setEditingBattle(null)}
          opponentDeckNameMap={opponentDeckNameMap}
        />
      )}
    </>
  );
}
