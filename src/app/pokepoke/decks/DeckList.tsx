"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createDeck,
  updateDeck,
  archiveDeck,
  getDecks,
  createTuning,
  updateTuning,
  deleteTuning,
} from "@/lib/actions/deck-actions";
import {
  displayDeckName,
  type OpponentDeckNameMap,
} from "@/lib/actions/opponent-deck-display";
import { matchesQuery } from "@/lib/search/normalize";
import { stripAllWhitespace } from "@/lib/util/whitespace";
import { Pencil, X, Search } from "lucide-react";

type Tuning = {
  id: string;
  name: string;
  sort_order: number;
};

type Deck = {
  id: string;
  name: string;
  sort_order: number;
  deck_tunings: Tuning[];
};

export function DeckList({
  initialDecks,
  format,
  suggestions = { major: [], minor: [], other: [] },
  opponentDeckNameMap,
}: {
  initialDecks: Deck[];
  format: string;
  suggestions?: { major: string[]; minor: string[]; other: string[] };
  opponentDeckNameMap?: OpponentDeckNameMap;
}) {
  const [decks, setDecks] = useState(initialDecks);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [freeInput, setFreeInput] = useState("");
  const [showMoreOther, setShowMoreOther] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [toastVisible, setToastVisible] = useState(false);

  const [deckError, setDeckError] = useState<string | null>(null);
  const [tuningError, setTuningError] = useState<string | null>(null);

  // Tuning state
  const [expandedDecks, setExpandedDecks] = useState<Set<string>>(new Set());
  const [newTuningName, setNewTuningName] = useState("");
  const [editingTuningId, setEditingTuningId] = useState<string | null>(null);
  const [editTuningName, setEditTuningName] = useState("");

  const registeredNames = new Set(decks.map(d => d.name));

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 1700);
    setTimeout(() => setToastMsg(null), 2000);
  }, []);

  const toggleExpanded = (deckId: string) => {
    setExpandedDecks((prev) => {
      const next = new Set(prev);
      if (next.has(deckId)) {
        next.delete(deckId);
      } else {
        next.add(deckId);
      }
      return next;
    });
  };

  const display = (name: string) => displayDeckName(name, opponentDeckNameMap);

  // Filter chips by search query (日本語表示名 / 英語原名どちらでもヒット)
  // NFKC + lowercase + ひらがな→カタカナ正規化で表記揺れ吸収 (共通 helper)
  const filterByQuery = (items: string[]) => {
    if (!searchQuery) return items;
    return items.filter((s) => matchesQuery(searchQuery, [s, display(s)]));
  };

  const filteredMajor = filterByQuery(suggestions.major);
  const filteredMinor = filterByQuery(suggestions.minor);
  const filteredOther = filterByQuery(suggestions.other);
  const noResults = searchQuery && filteredMajor.length === 0 && filteredMinor.length === 0 && filteredOther.length === 0;

  // Chip create handler
  const handleChipCreate = async (deckName: string) => {
    // 表示名 (label = display(name)) が渡されるケースを含むため、全空白削除で保存名を統一
    const cleaned = stripAllWhitespace(deckName);
    if (!cleaned || registeredNames.has(cleaned)) return;
    setLoading(true);
    setDeckError(null);
    try {
      const newDeck = await createDeck(cleaned, format, "pokepoke");
      if (newDeck) {
        setDecks((prev) => [...prev, { ...newDeck, deck_tunings: newDeck.deck_tunings ?? [] }]);
      } else {
        const updated = await getDecks(format, "pokepoke");
        setDecks(updated);
      }
      showToast(`${cleaned}を追加しました`);
    } catch (e) {
      setDeckError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  // Free input create handler
  const handleFreeCreate = async () => {
    // 自由入力でも全空白を削除して保存名を統一
    const name = stripAllWhitespace(freeInput.trim());
    if (!name) return;
    if (registeredNames.has(name)) {
      setDeckError("同名のデッキが既に登録されています");
      return;
    }
    setLoading(true);
    setDeckError(null);
    try {
      const newDeck = await createDeck(name, format, "pokepoke");
      setFreeInput("");
      if (newDeck) {
        setDecks((prev) => [...prev, { ...newDeck, deck_tunings: newDeck.deck_tunings ?? [] }]);
      } else {
        const updated = await getDecks(format, "pokepoke");
        setDecks(updated);
      }
      showToast(`${name}を追加しました`);
    } catch (e) {
      setDeckError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (id: string) => {
    // 編集時も全空白削除して保存名を統一
    const cleaned = stripAllWhitespace(editName.trim());
    if (!cleaned) return;
    setLoading(true);
    setDeckError(null);
    try {
      await updateDeck(id, cleaned);
      setDecks(
        decks.map((d) => (d.id === id ? { ...d, name: cleaned } : d))
      );
      setEditingId(null);
    } catch (e) {
      setDeckError(e instanceof Error ? e.message : "エラーが発生しました");
    } finally {
      setLoading(false);
    }
  };

  const handleArchive = async (id: string) => {
    setLoading(true);
    try {
      await archiveDeck(id);
      setDecks(decks.filter((d) => d.id !== id));
    } catch (e) {
      console.error(e);
      alert("デッキの削除に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  // Tuning handlers
  const handleCreateTuning = async (deckId: string) => {
    if (!newTuningName.trim()) return;
    setTuningError(null);
    try {
      const tuning = await createTuning(deckId, newTuningName.trim());
      setDecks(decks.map(d => d.id === deckId ? {
        ...d,
        deck_tunings: [...d.deck_tunings, tuning],
      } : d));
      setNewTuningName("");
    } catch (e) {
      setTuningError(e instanceof Error ? e.message : "エラーが発生しました");
    }
  };

  const handleUpdateTuning = async (deckId: string, tuningId: string) => {
    if (!editTuningName.trim()) return;
    setTuningError(null);
    try {
      await updateTuning(tuningId, editTuningName.trim());
      setDecks(decks.map(d => d.id === deckId ? {
        ...d,
        deck_tunings: d.deck_tunings.map(t => t.id === tuningId ? { ...t, name: editTuningName.trim() } : t),
      } : d));
      setEditingTuningId(null);
    } catch (e) {
      setTuningError(e instanceof Error ? e.message : "エラーが発生しました");
    }
  };

  const handleDeleteTuning = async (deckId: string, tuningId: string) => {
    try {
      await deleteTuning(tuningId);
      setDecks(decks.map(d => d.id === deckId ? {
        ...d,
        deck_tunings: d.deck_tunings.filter(t => t.id !== tuningId),
      } : d));
    } catch (e) {
      console.error(e);
      alert("チューニングの削除に失敗しました");
    }
  };

  const isExpanded = (deckId: string) => expandedDecks.has(deckId);

  return (
    <div>
      {/* Upper area: registered decks */}
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)", marginBottom: 10 }}>
        登録済みデッキ
      </div>

      {decks.length === 0 ? (
        <p className="text-center text-muted-foreground py-6 text-sm">
          デッキを追加してください
        </p>
      ) : (
        <div className="space-y-3">
          {decks.map((deck) => (
            <div key={deck.id} className="rounded-[10px] bg-surface-2 overflow-hidden">
              {/* Card header */}
              <div
                className="flex items-center gap-2 px-4 py-3 cursor-pointer"
                onClick={() => {
                  if (editingId !== deck.id) toggleExpanded(deck.id);
                }}
              >
                {editingId === deck.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) handleUpdate(deck.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent border-b border-primary text-sm text-foreground focus:outline-none"
                      autoFocus
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUpdate(deck.id); }}
                      className="text-sm text-primary"
                    >
                      保存
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingId(null); }}
                      className="text-sm text-muted-foreground"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-medium text-foreground truncate">{deck.name}</div>
                      <div className="text-[11px] text-muted-foreground">チューニング {deck.deck_tunings.length}件</div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(deck.id);
                        setEditName(deck.name);
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-md"
                      style={{ backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)", color: "var(--primary)" }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={(e) => {
                        if (!window.confirm(`「${deck.name}」を削除しますか？`)) { e.stopPropagation(); return; }
                        e.stopPropagation();
                        handleArchive(deck.id);
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-md"
                      style={{ backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)", color: "var(--destructive)" }}
                    >
                      <X size={16} />
                    </button>
                    <span className="text-muted-foreground text-sm ml-1 w-4 text-center select-none">
                      {isExpanded(deck.id) ? "▾" : "▸"}
                    </span>
                  </>
                )}
              </div>

              {/* Expanded tuning section */}
              {isExpanded(deck.id) && (
                <div className="bg-surface-1 border-t border-border">
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)", padding: "8px 16px 0 16px" }}>構築の調整パターンを追加できます</div>
                  {deck.deck_tunings.map((tuning, idx) => (
                    <div
                      key={tuning.id}
                      className={"flex items-center gap-3 px-4 py-2.5" + (idx < deck.deck_tunings.length - 1 ? " border-b border-border" : "")}
                    >
                      {editingTuningId === tuning.id ? (
                        <>
                          <div className="w-[3px] self-stretch rounded-sm bg-primary flex-shrink-0" />
                          <input
                            type="text"
                            value={editTuningName}
                            onChange={(e) => setEditTuningName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.nativeEvent.isComposing) handleUpdateTuning(deck.id, tuning.id);
                            }}
                            className="flex-1 bg-transparent border-b border-primary text-[13px] text-foreground focus:outline-none"
                            autoFocus
                          />
                          <button onClick={() => handleUpdateTuning(deck.id, tuning.id)} className="text-xs text-primary">保存</button>
                          <button onClick={() => setEditingTuningId(null)} className="text-xs text-muted-foreground">取消</button>
                        </>
                      ) : (
                        <>
                          <div className="w-[3px] self-stretch rounded-sm bg-primary flex-shrink-0" />
                          <span className="flex-1 text-[13px] text-foreground">{tuning.name}</span>
                          <button
                            onClick={() => { setEditingTuningId(tuning.id); setEditTuningName(tuning.name); }}
                            className="text-xs text-primary"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => { if (!window.confirm(`「${tuning.name}」を削除しますか？`)) return; handleDeleteTuning(deck.id, tuning.id); }}
                            className="text-xs text-destructive"
                          >
                            削除
                          </button>
                        </>
                      )}
                    </div>
                  ))}

                  <div className="flex gap-2 px-4 py-3 border-t border-border">
                    <input
                      type="text"
                      placeholder="例：スパーク入り、クロック型"
                      value={newTuningName}
                      onChange={(e) => setNewTuningName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) handleCreateTuning(deck.id);
                      }}
                      className="flex-1 rounded-md bg-surface-2 border-[0.5px] border-border px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <button
                      onClick={() => handleCreateTuning(deck.id)}
                      disabled={!newTuningName.trim()}
                      className="rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50"
                      style={{ backgroundColor: "color-mix(in srgb, var(--primary) 15%, transparent)", color: "var(--primary)" }}
                    >
                      追加
                    </button>
                  </div>
                  {tuningError && isExpanded(deck.id) && (
                    <p className="text-xs text-destructive px-4 pb-2">{tuningError}</p>
                  )}
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)", padding: "4px 16px 8px 16px" }}>※チューニング内容は対戦記録時、戦績共有中のDiscordサーバー内で共有されます（他ユーザーには非公開）</div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {deckError && (
        <p className="text-sm text-destructive mt-2">{deckError}</p>
      )}

      {/* Border separator */}
      <div style={{ borderTop: "0.5px solid var(--surface-3)", margin: "20px 0" }} />

      {/* Lower area: add deck */}
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)", marginBottom: 4 }}>
        デッキを追加
      </div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 14 }}>
        タップしてデッキを登録できます
      </div>

      {/* Search filter */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "var(--surface-1)",
          borderRadius: 8,
          border: "0.5px solid var(--border)",
          padding: "8px 12px",
          marginBottom: 14,
        }}
      >
        <Search size={14} className="text-muted-foreground" />
        <input
          type="text"
          placeholder="デッキを検索..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--foreground)",
            fontSize: 13,
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            style={{ color: "var(--muted-foreground)", fontSize: 14, lineHeight: 1 }}
          >
            ✕
          </button>
        )}
      </div>

      {noResults ? (
        <p style={{ fontSize: 12, color: "var(--muted-foreground)", textAlign: "center", padding: "12px 0" }}>
          該当するデッキがありません。自由入力で追加してください。
        </p>
      ) : (
        <>
          {/* Major decks */}
          {filteredMajor.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 500, marginBottom: 8 }}>
                よく使われているデッキ
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {filteredMajor.map((name) => {
                  const label = display(name);
                  // sanitize 後の保存名 (内部空白なし) と chip label (内部空白あり) のミスマッチを拾う
                  const isRegistered =
                    registeredNames.has(name) ||
                    registeredNames.has(label) ||
                    registeredNames.has(stripAllWhitespace(label));
                  return (
                    <button
                      key={name}
                      onClick={() => handleChipCreate(label)}
                      disabled={loading || isRegistered}
                      style={{
                        padding: "7px 14px",
                        fontSize: 12,
                        background: "var(--surface-2)",
                        border: "0.5px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--foreground)",
                        opacity: isRegistered ? 0.35 : 1,
                        pointerEvents: isRegistered ? "none" : "auto",
                        cursor: isRegistered ? "default" : "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Minor decks */}
          {filteredMinor.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 500, marginBottom: 8 }}>
                その他のデッキ
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                {filteredMinor.map((name) => {
                  const label = display(name);
                  // sanitize 後の保存名 (内部空白なし) と chip label (内部空白あり) のミスマッチを拾う
                  const isRegistered =
                    registeredNames.has(name) ||
                    registeredNames.has(label) ||
                    registeredNames.has(stripAllWhitespace(label));
                  return (
                    <button
                      key={name}
                      onClick={() => handleChipCreate(label)}
                      disabled={loading || isRegistered}
                      style={{
                        padding: "6px 12px",
                        fontSize: 11,
                        background: "var(--surface-2)",
                        border: "0.5px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--foreground)",
                        opacity: isRegistered ? 0.35 : 1,
                        pointerEvents: isRegistered ? "none" : "auto",
                        cursor: isRegistered ? "default" : "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {!searchQuery && suggestions.other.length > 0 && (
                <button
                  onClick={() => setShowMoreOther((prev) => !prev)}
                  style={{
                    marginTop: 8,
                    padding: "6px 14px",
                    fontSize: 11,
                    borderRadius: 8,
                    background: "var(--surface-2)",
                    border: "1px dashed var(--border-subtle)",
                    color: "var(--muted-foreground)",
                    cursor: "pointer",
                  }}
                >
                  さらに表示{showMoreOther ? " ▴" : "..."}
                </button>
              )}
            </div>
          )}

          {/* Other decks (shown when searching or showMoreOther) */}
          {(searchQuery ? filteredOther.length > 0 : showMoreOther && suggestions.other.length > 0) && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  maxHeight: 120,
                  overflowY: "auto",
                }}
              >
                {(searchQuery ? filteredOther : suggestions.other).map((name) => {
                  const label = display(name);
                  // sanitize 後の保存名 (内部空白なし) と chip label (内部空白あり) のミスマッチを拾う
                  const isRegistered =
                    registeredNames.has(name) ||
                    registeredNames.has(label) ||
                    registeredNames.has(stripAllWhitespace(label));
                  return (
                    <button
                      key={name}
                      onClick={() => handleChipCreate(label)}
                      disabled={loading || isRegistered}
                      style={{
                        padding: "6px 12px",
                        fontSize: 11,
                        background: "var(--surface-2)",
                        border: "0.5px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--foreground)",
                        opacity: isRegistered ? 0.35 : 1,
                        pointerEvents: isRegistered ? "none" : "auto",
                        cursor: isRegistered ? "default" : "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Free input section */}
      <div style={{ borderTop: "0.5px solid var(--surface-3)", margin: "16px 0", paddingTop: 16 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="リストにないデッキ名を入力..."
            value={freeInput}
            onChange={(e) => { setFreeInput(e.target.value); setDeckError(null); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) handleFreeCreate();
            }}
            style={{
              flex: 1,
              background: "var(--surface-1)",
              borderRadius: 8,
              border: "0.5px solid var(--border)",
              padding: "10px 14px",
              color: "var(--foreground)",
              fontSize: 13,
              outline: "none",
            }}
          />
          <button
            onClick={handleFreeCreate}
            disabled={loading || !freeInput.trim()}
            style={{
              background: "var(--primary)",
              borderRadius: 8,
              color: "var(--foreground)",
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 500,
              border: "none",
              cursor: freeInput.trim() ? "pointer" : "default",
              opacity: freeInput.trim() ? 1 : 0.5,
            }}
          >
            追加
          </button>
        </div>
        <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 8 }}>
          同じデッキの構築調整は、デッキカードを開いてチューニングとして追加できます
        </div>
      </div>

      {/* Toast notification */}
      {toastMsg && (
        <div
          style={{
            position: "fixed",
            bottom: 80,
            left: "50%",
            transform: "translateX(-50%)",
            background: "color-mix(in srgb, var(--surface-2) 95%, transparent)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "10px 20px",
            fontSize: 13,
            color: "var(--foreground)",
            zIndex: 9999,
            opacity: toastVisible ? 1 : 0,
            transition: "opacity 0.3s",
            pointerEvents: "none",
          }}
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
