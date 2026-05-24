"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { OpponentDeckSelector } from "./OpponentDeckSelector";
import { getOpponentMemoSuggestions, deleteOpponentMemoSuggestion } from "@/lib/actions/battle-actions";
import { MemoSuggestionButton } from "./MemoSuggestionButton";
import { useGame } from "@/lib/games/context";
import { supportsDraw, type BattleResult } from "@/lib/battle/result-format";
import { stripAllWhitespace } from "@/lib/util/whitespace";

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
  tuning_id?: string | null;
  tuning_name?: string | null;
};

type Props = {
  battle: Battle;
  decks: Deck[];
  suggestions: { major: string[]; minor: string[]; other: string[] };
  onSave: (fields: {
    opponentDeckName: string;
    result: BattleResult;
    turnOrder: "first" | "second" | null;
    myDeckId: string;
    myDeckName: string;
    tuningId?: string | null;
    tuningName?: string | null;
    opponentMemo?: string | null;
  }) => Promise<void>;
  onClose: () => void;
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

export function EditBattleModal({ battle, decks, suggestions, onSave, onClose }: Props) {
  const { slug: game } = useGame();
  // active tuning を id→tuning で引けるようにする (name 比較に使うため Set ではなく Map)
  const activeTuningById = new Map<string, Tuning>();
  for (const d of decks) {
    for (const t of (d.deck_tunings ?? [])) activeTuningById.set(t.id, t);
  }

  // 記録時デッキが「同一 active デッキ ID かつ記録時名と一致」で現存するか。
  // 名前一致のみだと、削除/改名済み元デッキと同名の別 active デッキを後から
  // 作成したケースで誤判定するため id + name の複合判定にする。
  const recordedDeckExists = decks.some(
    d => d.id === battle.my_deck_id && d.name === battle.my_deck_name
  );
  // 記録時 tuning が「現存しない」または「現存するが現在名が記録時名と異なる(改名)」
  // なら snapshot 扱い。tuning 改名単体でも battles.tuning_name は記録時名で保持される
  // 設計 (tuning_id 不変 → normalize_battle_deck_names trigger の OLD 名保持分岐) のため、
  // 編集画面でも記録時名を初期選択にして履歴一覧と一貫させる。
  const recordedTuningStale =
    battle.tuning_id != null &&
    (!activeTuningById.has(battle.tuning_id) ||
      activeTuningById.get(battle.tuning_id)!.name !== battle.tuning_name);
  const needsSnapshot = !recordedDeckExists || recordedTuningStale;

  const initialValue = needsSnapshot
    ? "__snapshot__"
    : battle.tuning_id
      ? `${battle.my_deck_id}:${battle.tuning_id}`
      : battle.my_deck_id;
  const [selectedValue, setSelectedValue] = useState(initialValue);
  const [opponentDeckName, setOpponentDeckName] = useState(battle.opponent_deck_name);
  const [opponentMemo, setOpponentMemo] = useState(battle.opponent_memo ?? "");
  const [memoSuggestions, setMemoSuggestions] = useState<string[]>([]);
  const [showMemo, setShowMemo] = useState(!!battle.opponent_memo);
  const [result, setResult] = useState<BattleResult>(battle.result);
  const [turnOrder, setTurnOrder] = useState<"first" | "second" | null>(battle.turn_order);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const cleaned = stripAllWhitespace(opponentDeckName);
    if (cleaned) {
      getOpponentMemoSuggestions(cleaned, game).then(setMemoSuggestions);
    } else {
      // opponentDeckName がクリアされたら memoSuggestions を空に同期リセット。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMemoSuggestions([]);
    }
  }, [opponentDeckName, game]);

  const deckNameMap = new Map<string, string>();
  const tuningNameMap = new Map<string, string>();
  for (const deck of decks) {
    deckNameMap.set(deck.id, deck.name);
    for (const t of (deck.deck_tunings ?? [])) {
      tuningNameMap.set(t.id, t.name);
    }
  }

  const deckOptions: { value: string; label: string }[] = [];

  if (needsSnapshot) {
    const snapshotLabel = battle.tuning_name
      ? `${battle.my_deck_name} / ${battle.tuning_name}(記録時)`
      : `${battle.my_deck_name}(記録時)`;
    deckOptions.push({ value: "__snapshot__", label: snapshotLabel });
  }

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

  const handleSave = async () => {
    setSaving(true);
    try {
      let deckId: string;
      let tuningId: string | null;
      let myDeckName: string;
      let tuningName: string | null;

      if (selectedValue === "__snapshot__") {
        deckId = battle.my_deck_id;
        tuningId = battle.tuning_id ?? null;
        myDeckName = battle.my_deck_name;
        tuningName = battle.tuning_name ?? null;
      } else {
        const parsed = parseDeckSelection(selectedValue);
        deckId = parsed.deckId;
        tuningId = parsed.tuningId;
        myDeckName = deckNameMap.get(deckId) ?? "";
        tuningName = tuningId ? tuningNameMap.get(tuningId) ?? null : null;
      }

      await onSave({
        opponentDeckName: stripAllWhitespace(opponentDeckName),
        result,
        turnOrder,
        myDeckId: deckId,
        myDeckName,
        tuningId,
        tuningName,
        opponentMemo: opponentMemo.trim() || null,
      });
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const hasMemo = opponentMemo.trim().length > 0;

  const memoHeaderExtra = (
    <button
      type="button"
      onClick={() => setShowMemo(prev => !prev)}
      className={`flex items-center gap-1 px-2 py-[3px] rounded-md transition-all ${
        showMemo ? "bg-primary/10 border border-primary/30" : "border border-transparent"
      }`}
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

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border p-5 w-[90%] max-w-md space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-bold">対戦記録を編集</h2>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">使用デッキ</label>
          <select
            value={selectedValue}
            onChange={(e) => setSelectedValue(e.target.value)}
            className="w-full rounded-lg bg-background border border-border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
          >
            {deckOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <OpponentDeckSelector
            majorSuggestions={suggestions.major}
            minorSuggestions={suggestions.minor}
            otherSuggestions={suggestions.other}
            value={opponentDeckName}
            onChange={setOpponentDeckName}
            headerExtra={memoHeaderExtra}
          />

          {showMemo && (
            <div className="mt-2 rounded-md border border-border-subtle bg-surface-2 px-3 py-2.5">
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
                          await deleteOpponentMemoSuggestion(stripAllWhitespace(opponentDeckName), memo, game);
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

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">先攻/後攻(任意)</label>
          <div className="flex gap-2">
            {(["first", "second"] as const).map((order) => (
              <button
                key={order}
                type="button"
                onClick={() => setTurnOrder(turnOrder === order ? null : order)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors min-h-[44px] ${
                  turnOrder === order
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-muted text-muted-foreground"
                }`}
              >
                {order === "first" ? "先攻" : "後攻"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm text-muted-foreground">勝敗</label>
          <div className="flex gap-2">
            {((supportsDraw(game) ? ["win", "draw", "loss"] : ["win", "loss"]) as BattleResult[]).map((r) => {
              const selectedClass =
                r === "win" ? "border-success bg-success/10 text-success"
                : r === "loss" ? "border-destructive bg-destructive/10 text-destructive"
                : "border-warning bg-warning/10 text-warning";
              const label = r === "win" ? "WIN" : r === "loss" ? "LOSE" : "DRAW";
              return (
                <button
                  key={r}
                  type="button"
                  onClick={() => setResult(r)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors min-h-[44px] ${
                    result === r
                      ? selectedClass
                      : "border-border bg-card hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border py-3 text-sm font-medium hover:bg-muted transition-colors min-h-[44px]"
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !stripAllWhitespace(opponentDeckName)}
            className="flex-1 rounded-lg bg-primary text-primary-foreground py-3 text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors min-h-[44px]"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
