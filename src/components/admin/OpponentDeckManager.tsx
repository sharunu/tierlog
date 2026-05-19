"use client";

import { DEFAULT_GAME, type GameSlug } from "@/lib/games";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  addOpponentDeck,
  updateOpponentDeck,
  deleteOpponentDeck,
  updateOpponentDeckSettings,
  recalculateOpponentDecks,
  reorderOpponentDecks,
  updateAdminBonusCount,
  getOpponentDeckStatsForAdmin,
  getOpponentDeckMasterList,
  getBattleCountsForPeriod,
  updateOpponentDeckNameJa,
  MissingNameEnError,
  triggerLimitlessSync,
  getOpponentDeckSettings,
} from "@/lib/actions/admin-actions";

type Mode = "admin" | "auto" | "limitless";

type Deck = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  category: string;
  admin_bonus_count?: number;
  source?: string | null;
  name_en?: string | null;
  name_ja?: string | null;
  name_ja_is_manual?: boolean | null;
  limitless_share?: number | null;
  limitless_count?: number | null;
  limitless_wins?: number | null;
  limitless_losses?: number | null;
  limitless_ties?: number | null;
  limitless_win_pct?: number | null;
  limitless_icon_urls?: string[] | null;
  limitless_last_synced_at?: string | null;
};

type DeckWithStats = Deck & {
  battle_count: number;
  usage_rate: number;
};

type Settings = {
  management_mode: string;
  major_threshold: number;
  minor_threshold: number;
  usage_period_days: number;
  disable_period_days: number;
  classification_method?: "threshold" | "fixed_count";
  major_fixed_count?: number;
  minor_fixed_count?: number;
  limitless_last_synced_at?: string | null;
  limitless_last_sync_status?: string | null;
  limitless_last_sync_message?: string | null;
};

const categoryCycle: Record<string, string> = { major: "minor", minor: "other", other: "major" };
const LIMITLESS_SYNC_PAUSED = true;
const LIMITLESS_SYNC_PAUSED_MESSAGE =
  "APIキー受領までLimitlessTCGからの新規取得を停止中です。既存キャッシュのみ表示しています。";

// --- Sortable deck item for Mode 1 ---
function SortableDeckItem({
  deck,
  editingId,
  editName,
  setEditName,
  onUpdate,
  onToggleActive,
  onToggleCategory,
  onDelete,
  onStartEdit,
  onCancelEdit,
  loading,
}: {
  deck: Deck;
  editingId: string | null;
  editName: string;
  setEditName: (v: string) => void;
  onUpdate: (id: string) => void;
  onToggleActive: (id: string, active: boolean) => void;
  onToggleCategory: (id: string, cat: string) => void;
  onDelete: (id: string) => void;
  onStartEdit: (id: string, name: string) => void;
  onCancelEdit: () => void;
  loading: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: deck.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-[8px] bg-surface-1 px-4 py-3 ${
        !deck.is_active ? "opacity-50" : ""
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
        tabIndex={-1}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>

      {editingId === deck.id ? (
        <>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onUpdate(deck.id)}
            className="flex-1 bg-transparent border-b border-primary-soft text-[14px] focus:outline-none"
            autoFocus
          />
          <button onClick={() => onUpdate(deck.id)} className="text-[13px] text-primary-soft min-h-[44px] px-2">保存</button>
          <button onClick={onCancelEdit} className="text-[13px] text-muted-foreground min-h-[44px] px-2">取消</button>
        </>
      ) : (
        <>
          <span className="flex-1 text-[14px]">{deck.name}</span>
          <button onClick={() => onToggleCategory(deck.id, deck.category)} className="text-[12px] px-2 py-1 rounded min-h-[44px] text-muted-foreground hover:text-foreground" disabled={loading}>
            →{categoryCycle[deck.category]}
          </button>
          <button onClick={() => onToggleActive(deck.id, deck.is_active)} className={`text-[12px] px-2 py-1 rounded min-h-[44px] ${deck.is_active ? "text-success" : "text-muted-foreground"}`} disabled={loading}>
            {deck.is_active ? "有効" : "無効"}
          </button>
          <button onClick={() => onStartEdit(deck.id, deck.name)} className="text-[12px] text-muted-foreground hover:text-foreground min-h-[44px] px-2" disabled={loading}>編集</button>
          <button onClick={() => onDelete(deck.id)} className="text-[12px] text-destructive hover:opacity-80 min-h-[44px] px-2" disabled={loading}>削除</button>
        </>
      )}
    </li>
  );
}

// --- Sortable list wrapper for a category ---
function SortableCategoryList({
  categoryDecks, allDecks, setDecks, categoryLabel,
  editingId, editName, setEditName,
  onUpdate, onToggleActive, onToggleCategory, onDelete, onStartEdit, onCancelEdit,
  loading, onReorder,
}: {
  categoryDecks: Deck[]; allDecks: Deck[]; setDecks: (d: Deck[]) => void; categoryLabel: string;
  editingId: string | null; editName: string; setEditName: (v: string) => void;
  onUpdate: (id: string) => void; onToggleActive: (id: string, active: boolean) => void;
  onToggleCategory: (id: string, cat: string) => void; onDelete: (id: string) => void;
  onStartEdit: (id: string, name: string) => void; onCancelEdit: () => void;
  loading: boolean; onReorder?: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categoryDecks.findIndex((d) => d.id === active.id);
    const newIndex = categoryDecks.findIndex((d) => d.id === over.id);
    const reordered = arrayMove(categoryDecks, oldIndex, newIndex);
    const otherDecks = allDecks.filter((d) => d.category !== categoryDecks[0]?.category);
    setDecks([...otherDecks, ...reordered]);
    onReorder?.();
  };

  return (
    <div className="bg-surface-2 rounded-[10px] px-4 py-4">
      <h3 className="text-[13px] font-medium text-muted-foreground mb-2">{categoryLabel}</h3>
      {categoryDecks.length === 0 ? (
        <p className="text-center text-muted-foreground py-4 text-sm">{categoryLabel}デッキなし</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={categoryDecks.map((d) => d.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {categoryDecks.map((deck) => (
                <SortableDeckItem key={deck.id} deck={deck} editingId={editingId} editName={editName} setEditName={setEditName}
                  onUpdate={onUpdate} onToggleActive={onToggleActive} onToggleCategory={onToggleCategory}
                  onDelete={onDelete} onStartEdit={onStartEdit} onCancelEdit={onCancelEdit} loading={loading} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

// --- Main component ---
export function OpponentDeckManager({
  initialDecks,
  format,
  game = DEFAULT_GAME,
  initialSettings,
  onDirtyChange,
  onApplyingChange,
  applyRef,
}: {
  initialDecks: Deck[];
  format: string;
  game?: GameSlug;
  initialSettings: Settings | null;
  onDirtyChange?: (dirty: boolean) => void;
  onApplyingChange?: (applying: boolean) => void;
  applyRef?: React.MutableRefObject<(() => Promise<void>) | undefined>;
}) {
  const [mode, setMode] = useState<Mode>(
    (initialSettings?.management_mode as Mode) ?? "admin"
  );
  const [decks, setDecks] = useState(initialDecks);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<"major" | "minor" | "other">("major");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [loading, setLoading] = useState(false);

  // Mode 2 specific — string state for free input
  const [majorThresholdStr, setMajorThresholdStr] = useState(String(initialSettings?.major_threshold ?? 3.0));
  const [minorThresholdStr, setMinorThresholdStr] = useState(String(initialSettings?.minor_threshold ?? 1.0));
  const [usagePeriodStr, setUsagePeriodStr] = useState(String(initialSettings?.usage_period_days ?? 14));
  const [disablePeriodStr, setDisablePeriodStr] = useState(String(initialSettings?.disable_period_days ?? 30));
  const [statsDecks, setStatsDecks] = useState<DeckWithStats[]>([]);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [trialCalcing, setTrialCalcing] = useState(false);
  const [bonusEditing, setBonusEditing] = useState<Record<string, string>>({});
  const [showHelp, setShowHelp] = useState(false);

  // limitless mode specific
  const [classificationMethod, setClassificationMethod] = useState<"threshold" | "fixed_count">(
    initialSettings?.classification_method ?? "threshold"
  );
  const [majorFixedCountStr, setMajorFixedCountStr] = useState(String(initialSettings?.major_fixed_count ?? 5));
  const [minorFixedCountStr, setMinorFixedCountStr] = useState(String(initialSettings?.minor_fixed_count ?? 10));
  const [limitlessSyncing, setLimitlessSyncing] = useState(false);
  const [limitlessMessage, setLimitlessMessage] = useState<string | null>(null);
  const [nameJaEditing, setNameJaEditing] = useState<Record<string, string>>({});

  // --- Batch apply state ---
  const [dirty, setDirty] = useState(false);
  const [applying, setApplying] = useState(false);
  const addedDeckIdsRef = useRef(new Set<string>());
  const deletedDeckIdsRef = useRef(new Set<string>());

  const savedModeRef = useRef<Mode>(
    (initialSettings?.management_mode as Mode) ?? "admin"
  );
  const savedDecksRef = useRef(initialDecks);
  const savedSettingsRef = useRef(initialSettings);
  const savedStatsDecksRef = useRef<DeckWithStats[]>([]);

  // Notify parent of dirty/applying changes
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { onApplyingChange?.(applying); }, [applying, onApplyingChange]);
  useEffect(() => { if (applyRef) applyRef.current = handleApply; });

  // Sync with initialSettings/initialDecks when format changes
  useEffect(() => {
    const m = (initialSettings?.management_mode as Mode) ?? "admin";
    setMode(m);
    setDecks(initialDecks);
    setMajorThresholdStr(String(initialSettings?.major_threshold ?? 3.0));
    setMinorThresholdStr(String(initialSettings?.minor_threshold ?? 1.0));
    setUsagePeriodStr(String(initialSettings?.usage_period_days ?? 14));
    setDisablePeriodStr(String(initialSettings?.disable_period_days ?? 30));
    setClassificationMethod(initialSettings?.classification_method ?? "threshold");
    setMajorFixedCountStr(String(initialSettings?.major_fixed_count ?? 5));
    setMinorFixedCountStr(String(initialSettings?.minor_fixed_count ?? 10));
    setNameJaEditing({});
    setLimitlessMessage(null);
    setStatsLoaded(false);
    setDirty(false);
    addedDeckIdsRef.current.clear();
    deletedDeckIdsRef.current.clear();
    savedModeRef.current = m;
    savedDecksRef.current = initialDecks;
    savedSettingsRef.current = initialSettings;
    savedStatsDecksRef.current = [];
  }, [initialDecks, initialSettings]);

  const loadStats = useCallback(async () => {
    try {
      const result = await getOpponentDeckStatsForAdmin(format, game);
      const d = result.decks as DeckWithStats[];
      setStatsDecks(d);
      savedStatsDecksRef.current = d;
      setStatsLoaded(true);
    } catch (e) {
      console.error(e);
      alert("操作に失敗しました");
    }
  }, [format, game]);

  // Load stats when switching to auto mode
  useEffect(() => {
    if (mode === "auto" && !statsLoaded) {
      loadStats();
    }
  }, [mode, statsLoaded, loadStats]);

  // Warn on browser navigation when dirty
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Parse string settings to numbers
  const parseSettings = () => ({
    majorThreshold: parseFloat(majorThresholdStr) || 0,
    minorThreshold: parseFloat(minorThresholdStr) || 0,
    usagePeriod: parseInt(usagePeriodStr) || 1,
    disablePeriod: parseInt(disablePeriodStr) || 1,
  });

  const majorDecks = decks.filter((d) => d.category === "major");
  const minorDecks = decks.filter((d) => d.category === "minor");
  const otherDecks = decks.filter((d) => d.category === "other");

  // --- Handlers (all local) ---

  const handleModeChange = (newMode: Mode) => {
    setMode(newMode);
    if (newMode === "auto") setStatsLoaded(false);
    setDirty(true);
  };

  const handleLimitlessSync = async () => {
    if (LIMITLESS_SYNC_PAUSED) {
      setLimitlessMessage(LIMITLESS_SYNC_PAUSED_MESSAGE);
      return;
    }

    setLimitlessSyncing(true);
    setLimitlessMessage("取得中...");
    try {
      const res = await triggerLimitlessSync();
      setLimitlessMessage(res.message);
      if (res.ok) {
        const [freshDecks, freshSettings] = await Promise.all([
          getOpponentDeckMasterList(format, game),
          getOpponentDeckSettings(format, game),
        ]);
        setDecks(freshDecks);
        savedDecksRef.current = freshDecks;
        savedSettingsRef.current = freshSettings as Settings | null;
      }
    } catch (e) {
      console.error(e);
      setLimitlessMessage("取得失敗");
    } finally {
      setLimitlessSyncing(false);
    }
  };

  const handleNameJaBlur = async (deckId: string, original: string | null | undefined) => {
    const value = nameJaEditing[deckId];
    if (value === undefined) return;
    if ((value ?? "") === (original ?? "")) {
      const next = { ...nameJaEditing };
      delete next[deckId];
      setNameJaEditing(next);
      return;
    }
    try {
      const result = await updateOpponentDeckNameJa(deckId, value);
      setDecks((prev) =>
        prev.map((d) =>
          d.id === deckId
            ? {
                ...d,
                name: result.updated_name,
                name_ja: result.name_ja,
                name_ja_is_manual: result.name_ja_is_manual,
              }
            : d,
        ),
      );
      setStatsDecks((prev) =>
        prev.map((d) =>
          d.id === deckId ? { ...d, name: result.updated_name } : d,
        ),
      );
      const next = { ...nameJaEditing };
      delete next[deckId];
      setNameJaEditing(next);
    } catch (e) {
      console.error(e);
      if (e instanceof MissingNameEnError) {
        alert("再生成元の英名がないため自動翻訳できません。和名を直接入力してください。");
        const next = { ...nameJaEditing };
        delete next[deckId];
        setNameJaEditing(next);
        return;
      }
      alert("名称保存に失敗しました");
    }
  };

  const handleAdd = () => {
    if (!newName.trim()) return;
    const tempId = crypto.randomUUID();
    const maxOrder = decks.length > 0 ? Math.max(...decks.map((d) => d.sort_order)) : 0;
    const newDeck: Deck = { id: tempId, name: newName.trim(), sort_order: maxOrder + 10, is_active: true, category: newCategory };
    setDecks((prev) => [...prev, newDeck]);
    addedDeckIdsRef.current.add(tempId);
    setNewName("");
    setDirty(true);
    if (mode === "auto") {
      setStatsDecks((prev) => [...prev, { ...newDeck, battle_count: 0, usage_rate: 0, admin_bonus_count: 0 }]);
    }
  };

  const handleUpdate = (id: string) => {
    if (!editName.trim()) return;
    setDecks(decks.map((d) => (d.id === id ? { ...d, name: editName.trim() } : d)));
    setStatsDecks(statsDecks.map((d) => (d.id === id ? { ...d, name: editName.trim() } : d)));
    setEditingId(null);
    setDirty(true);
  };

  const handleToggleActive = (id: string, currentActive: boolean) => {
    setDecks(decks.map((d) => (d.id === id ? { ...d, is_active: !currentActive } : d)));
    setStatsDecks(statsDecks.map((d) => (d.id === id ? { ...d, is_active: !currentActive } : d)));
    setDirty(true);
  };

  const handleToggleCategory = (id: string, currentCategory: string) => {
    const newCat = categoryCycle[currentCategory] ?? "major";
    setDecks(decks.map((d) => (d.id === id ? { ...d, category: newCat } : d)));
    setDirty(true);
  };

  const handleDelete = (id: string) => {
    if (!confirm("このデッキを削除しますか？")) return;
    setDecks(decks.filter((d) => d.id !== id));
    setStatsDecks(statsDecks.filter((d) => d.id !== id));
    if (addedDeckIdsRef.current.has(id)) {
      addedDeckIdsRef.current.delete(id);
    } else {
      deletedDeckIdsRef.current.add(id);
    }
    setDirty(true);
  };

  const handleBonusChange = (id: string, value: string) => {
    setBonusEditing({ ...bonusEditing, [id]: value });
  };

  const handleBonusSubmit = (id: string) => {
    const val = bonusEditing[id];
    if (val === undefined) return;
    const num = parseInt(val, 10);
    if (isNaN(num)) return;
    setStatsDecks(statsDecks.map((d) => (d.id === id ? { ...d, admin_bonus_count: num } : d)));
    const newEditing = { ...bonusEditing };
    delete newEditing[id];
    setBonusEditing(newEditing);
    setDirty(true);
  };

  // --- Trial calculation (auto mode) ---
  const handleTrialCalc = async () => {
    setTrialCalcing(true);
    try {
      const { majorThreshold, minorThreshold, usagePeriod } = parseSettings();

      // 1. Fetch battle counts for the specified period (read-only, no DB writes)
      const battleCounts = await getBattleCountsForPeriod(format, usagePeriod, game);

      // 2. Calculate denominator with local bonus counts
      const totalBattles = Object.values(battleCounts).reduce((a, b) => a + b, 0);
      const totalBonus = statsDecks
        .filter((d) => d.is_active && !deletedDeckIdsRef.current.has(d.id))
        .reduce((sum, d) => sum + (d.admin_bonus_count ?? 0), 0);
      const denominator = totalBattles + totalBonus;

      // 3. Recalculate usage_rate and category client-side
      const updated = statsDecks.map((d) => {
        if (!d.is_active || denominator === 0) return d;
        const bc = battleCounts[d.name] ?? 0;
        const rate = ((bc + (d.admin_bonus_count ?? 0)) * 100) / denominator;
        const cat = rate >= majorThreshold ? "major" : rate >= minorThreshold ? "minor" : "other";
        return { ...d, battle_count: bc, usage_rate: rate, category: cat };
      });

      // 4. Sort: major -> minor -> other, within each by rate desc then name asc
      updated.sort((a, b) => {
        if (!a.is_active && b.is_active) return 1;
        if (a.is_active && !b.is_active) return -1;
        const catOrder: Record<string, number> = { major: 0, minor: 1, other: 2 };
        const catDiff = (catOrder[a.category] ?? 2) - (catOrder[b.category] ?? 2);
        if (catDiff !== 0) return catDiff;
        if (b.usage_rate !== a.usage_rate) return b.usage_rate - a.usage_rate;
        return a.name.localeCompare(b.name);
      });

      setStatsDecks(updated);
      // No DB writes. dirty/snapshots unchanged.
    } catch (e) {
      console.error(e);
      alert("試し計算に失敗しました");
    } finally {
      setTrialCalcing(false);
    }
  };

  // --- Apply all changes to DB ---
  const handleApply = async () => {
    setApplying(true);
    try {
      const { majorThreshold, minorThreshold, usagePeriod, disablePeriod } = parseSettings();
      const majorFixed = Math.max(0, parseInt(majorFixedCountStr, 10) || 0);
      const minorFixed = Math.max(0, parseInt(minorFixedCountStr, 10) || 0);

      // 1. Save settings (limitless モードは DB 側で category を決めるためデッキ操作はしない)
      await updateOpponentDeckSettings(format, {
        management_mode: mode,
        major_threshold: majorThreshold,
        minor_threshold: minorThreshold,
        usage_period_days: usagePeriod,
        disable_period_days: disablePeriod,
        classification_method: classificationMethod,
        major_fixed_count: majorFixed,
        minor_fixed_count: minorFixed,
      }, game);

      if (mode === "limitless") {
        savedModeRef.current = mode;
        savedSettingsRef.current = {
          management_mode: mode,
          major_threshold: majorThreshold,
          minor_threshold: minorThreshold,
          usage_period_days: usagePeriod,
          disable_period_days: disablePeriod,
          classification_method: classificationMethod,
          major_fixed_count: majorFixed,
          minor_fixed_count: minorFixed,
        };
        // 分類方式・閾値を変えた場合は再同期でカテゴリ再計算させる
        if (!LIMITLESS_SYNC_PAUSED) {
          await triggerLimitlessSync().catch(() => {});
        }
        const freshDecks = await getOpponentDeckMasterList(format, game);
        setDecks(freshDecks);
        savedDecksRef.current = freshDecks;
        setDirty(false);
        return;
      }

      // 2. Delete
      for (const id of deletedDeckIdsRef.current) {
        await deleteOpponentDeck(id);
      }

      // 3. Add
      for (const deck of decks) {
        if (addedDeckIdsRef.current.has(deck.id)) {
          await addOpponentDeck(deck.name, format, deck.category, game);
        }
      }

      // 4. Update
      const saved = savedDecksRef.current;
      for (const deck of decks) {
        if (addedDeckIdsRef.current.has(deck.id) || deletedDeckIdsRef.current.has(deck.id)) continue;
        const orig = saved.find((d) => d.id === deck.id);
        if (!orig) continue;
        const changes: Record<string, unknown> = {};
        if (deck.name !== orig.name) changes.name = deck.name;
        if (deck.category !== orig.category) changes.category = deck.category;
        if (deck.is_active !== orig.is_active) changes.is_active = deck.is_active;
        if (Object.keys(changes).length > 0) {
          await updateOpponentDeck(deck.id, changes);
        }
      }

      // 5. Reorder (admin mode)
      if (mode === "admin") {
        for (const cat of ["major", "minor", "other"]) {
          const catDecks = decks.filter(
            (d) => d.category === cat && !addedDeckIdsRef.current.has(d.id) && !deletedDeckIdsRef.current.has(d.id)
          );
          if (catDecks.length > 0) {
            await reorderOpponentDecks(catDecks.map((d) => d.id));
          }
        }
      }

      // 6. Bonus counts (auto mode)
      if (mode === "auto") {
        const savedStats = savedStatsDecksRef.current;
        for (const deck of statsDecks) {
          if (addedDeckIdsRef.current.has(deck.id) || deletedDeckIdsRef.current.has(deck.id)) continue;
          const orig = savedStats.find((d) => d.id === deck.id);
          if (orig && (deck.admin_bonus_count ?? 0) !== (orig.admin_bonus_count ?? 0)) {
            await updateAdminBonusCount(deck.id, deck.admin_bonus_count ?? 0);
          }
        }
      }

      // 7. Recalculate (auto mode)
      if (mode === "auto") {
        await recalculateOpponentDecks(format, game);
      }

      // 8. Reload
      const freshDecks = await getOpponentDeckMasterList(format, game);
      setDecks(freshDecks);
      savedDecksRef.current = freshDecks;
      savedModeRef.current = mode;
      savedSettingsRef.current = {
        management_mode: mode,
        major_threshold: majorThreshold,
        minor_threshold: minorThreshold,
        usage_period_days: usagePeriod,
        disable_period_days: disablePeriod,
        classification_method: classificationMethod,
        major_fixed_count: majorFixed,
        minor_fixed_count: minorFixed,
      };

      if (mode === "auto") {
        const result = await getOpponentDeckStatsForAdmin(format, game);
        const freshStats = result.decks as DeckWithStats[];
        setStatsDecks(freshStats);
        savedStatsDecksRef.current = freshStats;
      }

      addedDeckIdsRef.current.clear();
      deletedDeckIdsRef.current.clear();
      setBonusEditing({});
      setDirty(false);
    } catch (e) {
      console.error(e);
      alert("反映に失敗しました");
    } finally {
      setApplying(false);
    }
  };

  // --- Add form (shared) ---
  const addForm = (
    <div className="bg-surface-2 rounded-[10px] px-4 py-4 space-y-2">
      <div className="flex gap-2">
        {(["major", "minor", "other"] as const).map((cat) => (
          <button key={cat} type="button" onClick={() => setNewCategory(cat)}
            className={`rounded-[6px] px-3 py-2 text-[13px] transition-colors ${
              newCategory === cat ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground border border-border"
            }`}
          >{cat}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" placeholder="デッキ名を入力" value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] placeholder:text-muted-foreground focus:outline-none"
        />
        <button onClick={handleAdd} disabled={loading || !newName.trim()}
          className="bg-primary text-primary-foreground rounded-[6px] px-4 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50"
        >追加</button>
      </div>
    </div>
  );

  const sortableProps = {
    editingId, editName, setEditName,
    onUpdate: handleUpdate,
    onToggleActive: handleToggleActive,
    onToggleCategory: handleToggleCategory,
    onDelete: handleDelete,
    onStartEdit: (id: string, name: string) => { setEditingId(id); setEditName(name); },
    onCancelEdit: () => setEditingId(null),
    loading,
    onReorder: () => setDirty(true),
  };

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="bg-surface-2 rounded-[10px] px-4 py-4">
        <p className="text-[12px] text-muted-foreground mb-2">管理モード</p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => handleModeChange("admin")} disabled={applying}
            className={`flex-1 min-w-[120px] rounded-[6px] px-3 py-3 text-[13px] transition-colors min-h-[44px] ${
              mode === "admin" ? "bg-primary/15 border border-primary text-primary-soft"
                : "bg-surface-1 border border-transparent text-muted-foreground"
            }`}
          >完全管理者依存</button>
          <button onClick={() => handleModeChange("auto")} disabled={applying}
            className={`flex-1 min-w-[120px] rounded-[6px] px-3 py-3 text-[13px] transition-colors min-h-[44px] ${
              mode === "auto" ? "bg-primary/15 border border-primary text-primary-soft"
                : "bg-surface-1 border border-transparent text-muted-foreground"
            }`}
          >ユーザー入力依存</button>
          {game === "pokepoke" && (
            <button onClick={() => handleModeChange("limitless")} disabled={applying}
              className={`flex-1 min-w-[120px] rounded-[6px] px-3 py-3 text-[13px] transition-colors min-h-[44px] ${
                mode === "limitless" ? "bg-primary/15 border border-primary text-primary-soft"
                  : "bg-surface-1 border border-transparent text-muted-foreground"
              }`}
            >LimitLessTCG依存</button>
          )}
        </div>
      </div>

      {/* Help */}
      <button onClick={() => setShowHelp(!showHelp)}
        className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`transition-transform ${showHelp ? "rotate-90" : ""}`}
        ><path d="M9 18l6-6-6-6" /></svg>
        {showHelp ? "各モードの説明を閉じる" : "各モードの説明"}
      </button>
      {showHelp && (
        <div className="bg-surface-1 rounded-[10px] px-4 py-4 text-[12px] text-muted-foreground space-y-3">
          <div>
            <p className="text-foreground font-medium mb-1">■ 共通</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>すべての変更は「変更内容反映」ボタンを押すまでDBに反映されません</li>
              <li>「変更内容反映」を押さずにページを離れると、変更は破棄されます</li>
              <li>ユーザー側UIへの反映はDB保存後、次回ページ読み込み時です</li>
            </ul>
          </div>
          <div>
            <p className="text-foreground font-medium mb-1">■ 完全管理者依存</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>カテゴリ(major/minor/other)と並び順は手動で管理します</li>
              <li>対戦記録で未登録デッキが使われた場合、無効状態で自動追加されます</li>
            </ul>
          </div>
          <div>
            <p className="text-foreground font-medium mb-1">■ ユーザー入力依存</p>
            <ul className="space-y-0.5 list-disc list-inside">
              <li>カテゴリと並び順は使用率に基づいて自動計算されます</li>
              <li>「試し計算」で設定値での計算結果をプレビューできます</li>
              <li>対戦記録で未登録デッキが使われた場合、有効状態で自動追加されます</li>
              <li>無効デッキが再使用されると自動的に有効に戻ります</li>
              <li>一定期間未使用のデッキは自動的に無効化されます</li>
            </ul>
          </div>
        </div>
      )}

      {mode === "limitless" ? (
        <>
          <div className="bg-surface-1 rounded-[10px] px-4 py-3 text-[12px] text-muted-foreground leading-relaxed">
            LimitlessTCG の公式大会 <span className="text-foreground">standard</span> データを既存キャッシュとして表示し、
            ポケポケの <span className="text-foreground">RANKED / RANDOM</span> 両フォーマットに流用しています。
            APIキー受領まで新規取得は停止中です。
            自分自身の戦績（battles）の使用率は反映されません。
          </div>

          {/* 同期状態 */}
          <div className="bg-surface-2 rounded-[10px] px-4 py-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[12px] text-muted-foreground">
                最終取得:{" "}
                <span className="text-foreground">
                  {savedSettingsRef.current?.limitless_last_synced_at
                    ? new Date(savedSettingsRef.current.limitless_last_synced_at).toLocaleString("ja-JP")
                    : "未取得"}
                </span>
                {savedSettingsRef.current?.limitless_last_sync_status && (
                  <span className="ml-2 text-muted-foreground">
                    ({savedSettingsRef.current.limitless_last_sync_status})
                  </span>
                )}
              </div>
              <button
                onClick={handleLimitlessSync}
                disabled={LIMITLESS_SYNC_PAUSED || limitlessSyncing || applying}
                className="bg-primary text-primary-foreground rounded-[6px] px-4 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50 min-h-[40px]"
              >
                {LIMITLESS_SYNC_PAUSED ? "取得停止中" : limitlessSyncing ? "取得中..." : "今すぐ取得"}
              </button>
            </div>
            <p className="text-[11px] text-warning">{LIMITLESS_SYNC_PAUSED_MESSAGE}</p>
            {limitlessMessage && (
              <p className="text-[11px] text-muted-foreground">{limitlessMessage}</p>
            )}
          </div>

          {/* 分類方式 */}
          <div className="bg-surface-2 rounded-[10px] px-4 py-4 space-y-3">
            <p className="text-[13px] font-medium text-muted-foreground">分類方式</p>
            <div className="flex gap-2">
              <label className={`flex-1 flex items-center gap-2 cursor-pointer rounded-[6px] px-3 py-2 text-[13px] border ${
                classificationMethod === "threshold"
                  ? "border-primary bg-primary/12"
                  : "border-transparent bg-surface-1"
              }`}>
                <input
                  type="radio"
                  name="classificationMethod"
                  value="threshold"
                  checked={classificationMethod === "threshold"}
                  onChange={() => { setClassificationMethod("threshold"); setDirty(true); }}
                  className="accent-primary-soft"
                />
                閾値方式
              </label>
              <label className={`flex-1 flex items-center gap-2 cursor-pointer rounded-[6px] px-3 py-2 text-[13px] border ${
                classificationMethod === "fixed_count"
                  ? "border-primary bg-primary/12"
                  : "border-transparent bg-surface-1"
              }`}>
                <input
                  type="radio"
                  name="classificationMethod"
                  value="fixed_count"
                  checked={classificationMethod === "fixed_count"}
                  onChange={() => { setClassificationMethod("fixed_count"); setDirty(true); }}
                  className="accent-primary-soft"
                />
                デッキ数固定方式
              </label>
            </div>
            {classificationMethod === "threshold" ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] text-muted-foreground block mb-1">major 閾値 (%)</label>
                  <input type="text" inputMode="decimal" value={majorThresholdStr}
                    onChange={(e) => { setMajorThresholdStr(e.target.value); setDirty(true); }}
                    className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-muted-foreground block mb-1">minor 閾値 (%)</label>
                  <input type="text" inputMode="decimal" value={minorThresholdStr}
                    onChange={(e) => { setMinorThresholdStr(e.target.value); setDirty(true); }}
                    className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] text-muted-foreground block mb-1">major デッキ数</label>
                  <input type="text" inputMode="numeric" value={majorFixedCountStr}
                    onChange={(e) => { setMajorFixedCountStr(e.target.value); setDirty(true); }}
                    className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-muted-foreground block mb-1">minor デッキ数</label>
                  <input type="text" inputMode="numeric" value={minorFixedCountStr}
                    onChange={(e) => { setMinorFixedCountStr(e.target.value); setDirty(true); }}
                    className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              ※「変更内容反映」ボタンで設定を保存し、同時に LimitlessTCG 再取得＆カテゴリ再計算を行います。
            </p>
          </div>

          {/* デッキ一覧 (source='limitless' の active のみ) */}
          {(["major", "minor", "other"] as const).map((cat) => {
            const catDecks = decks
              .filter((d) => d.source === "limitless" && d.is_active && d.category === cat)
              .sort((a, b) => (b.limitless_share ?? 0) - (a.limitless_share ?? 0));
            return (
              <div key={cat} className="bg-surface-2 rounded-[10px] px-4 py-4">
                <h3 className="text-[13px] font-medium text-muted-foreground mb-2">{cat}</h3>
                {catDecks.length === 0 ? (
                  <p className="text-center text-muted-foreground py-4 text-sm">{cat} デッキなし</p>
                ) : (
                  <ul className="space-y-2">
                    {catDecks.map((deck) => {
                      const displayJa = deck.name_ja ?? deck.name_en ?? deck.name;
                      const nameJaValue = nameJaEditing[deck.id] ?? (deck.name_ja ?? "");
                      return (
                        <li key={deck.id} className="rounded-[8px] bg-surface-1 px-4 py-3 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[14px] font-medium">{displayJa}</span>
                            {deck.name_ja_is_manual && (
                              <span className="text-[10px] text-primary-soft px-1.5 py-0.5 rounded bg-primary/20">手動</span>
                            )}
                          </div>
                          {deck.name_en && deck.name_en !== displayJa && (
                            <div className="text-[11px] text-muted-foreground">{deck.name_en}</div>
                          )}
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                            <span>share: <span className="text-foreground">{deck.limitless_share?.toFixed(2) ?? "-"}%</span></span>
                            <span>count: {deck.limitless_count ?? "-"}</span>
                            <span>
                              勝敗: {deck.limitless_wins ?? "-"}-{deck.limitless_losses ?? "-"}-{deck.limitless_ties ?? "-"}
                            </span>
                            <span>Win%: {deck.limitless_win_pct?.toFixed(2) ?? "-"}</span>
                          </div>
                          <div className="flex items-center gap-2 pt-1">
                            <label className="text-[11px] text-muted-foreground">和名:</label>
                            <input
                              type="text"
                              value={nameJaValue}
                              placeholder={deck.name_en ?? ""}
                              onChange={(e) =>
                                setNameJaEditing({ ...nameJaEditing, [deck.id]: e.target.value })
                              }
                              onBlur={() => handleNameJaBlur(deck.id, deck.name_ja)}
                              className="flex-1 bg-surface-1 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      ) : mode === "admin" ? (
        <>
          {addForm}
          <SortableCategoryList categoryDecks={majorDecks} allDecks={decks} setDecks={setDecks} categoryLabel="major" {...sortableProps} />
          <SortableCategoryList categoryDecks={minorDecks} allDecks={decks} setDecks={setDecks} categoryLabel="minor" {...sortableProps} />
          <SortableCategoryList categoryDecks={otherDecks} allDecks={decks} setDecks={setDecks} categoryLabel="other" {...sortableProps} />
        </>
      ) : (
        <>
          {/* Settings */}
          <div className="bg-surface-2 rounded-[10px] px-4 py-4 space-y-3">
            <p className="text-[13px] font-medium text-muted-foreground">設定</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] text-muted-foreground block mb-1">major閾値 (%)</label>
                <input type="text" inputMode="decimal" value={majorThresholdStr}
                  onChange={(e) => { setMajorThresholdStr(e.target.value); setDirty(true); }}
                  className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-[12px] text-muted-foreground block mb-1">minor閾値 (%)</label>
                <input type="text" inputMode="decimal" value={minorThresholdStr}
                  onChange={(e) => { setMinorThresholdStr(e.target.value); setDirty(true); }}
                  className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-[12px] text-muted-foreground block mb-1">算出期間 (日)</label>
                <input type="text" inputMode="numeric" value={usagePeriodStr}
                  onChange={(e) => { setUsagePeriodStr(e.target.value); setDirty(true); }}
                  className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="text-[12px] text-muted-foreground block mb-1">無効化期間 (日)</label>
                <input type="text" inputMode="numeric" value={disablePeriodStr}
                  onChange={(e) => { setDisablePeriodStr(e.target.value); setDirty(true); }}
                  className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <button
              onClick={handleTrialCalc}
              disabled={trialCalcing || applying}
              className="w-full bg-primary text-primary-foreground rounded-[6px] px-4 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50 min-h-[44px]"
            >
              {trialCalcing ? "計算中..." : "試し計算"}
            </button>
            <p className="text-[11px] text-muted-foreground">※現在の設定値・付与数でカテゴリを再計算し結果をプレビューします</p>
          </div>

          {addForm}

          {/* Stats list */}
          <div className="bg-surface-2 rounded-[10px] px-4 py-4">
            <p className="text-[13px] font-medium text-muted-foreground mb-3">デッキ一覧</p>
            {!statsLoaded ? (
              <p className="text-center text-muted-foreground py-4 text-sm">読み込み中...</p>
            ) : statsDecks.length === 0 ? (
              <p className="text-center text-muted-foreground py-4 text-sm">デッキなし</p>
            ) : (
              <ul className="space-y-2">
                {statsDecks.map((deck) => (
                  <li key={deck.id} className={`rounded-[8px] bg-surface-1 px-4 py-3 ${!deck.is_active ? "opacity-50" : ""}`}>
                    {editingId === deck.id ? (
                      <div className="flex items-center gap-2">
                        <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleUpdate(deck.id)}
                          className="flex-1 bg-transparent border-b border-primary-soft text-[14px] focus:outline-none" autoFocus />
                        <button onClick={() => handleUpdate(deck.id)} className="text-[13px] text-primary-soft min-h-[44px] px-2">保存</button>
                        <button onClick={() => setEditingId(null)} className="text-[13px] text-muted-foreground min-h-[44px] px-2">取消</button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[14px] font-medium">{deck.name}</span>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleToggleActive(deck.id, deck.is_active)}
                              className={`text-[12px] px-2 py-1 rounded min-h-[36px] ${deck.is_active ? "text-success" : "text-muted-foreground"}`}
                              disabled={applying}>
                              {deck.is_active ? "有効" : "無効"}
                            </button>
                            <button onClick={() => { setEditingId(deck.id); setEditName(deck.name); }}
                              className="text-[12px] text-muted-foreground hover:text-foreground min-h-[36px] px-1" disabled={applying}>編集</button>
                            <button onClick={() => handleDelete(deck.id)}
                              className="text-[12px] text-destructive hover:opacity-80 min-h-[36px] px-1" disabled={applying}>削除</button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
                          <span>対戦: {deck.battle_count}</span>
                          <span className="flex items-center gap-1">
                            付与:
                            <input type="number" value={bonusEditing[deck.id] ?? (deck.admin_bonus_count ?? 0)}
                              onChange={(e) => handleBonusChange(deck.id, e.target.value)}
                              onBlur={() => handleBonusSubmit(deck.id)}
                              onKeyDown={(e) => e.key === "Enter" && handleBonusSubmit(deck.id)}
                              className="w-[60px] bg-surface-1 rounded px-2 py-1 text-[12px] text-center focus:outline-none focus:ring-1 focus:ring-primary"
                            />
                          </span>
                          <span>率: {deck.usage_rate.toFixed(1)}%</span>
                          <span className={`px-1.5 py-0.5 rounded text-[11px] ${
                            deck.category === "major" ? "bg-primary/20 text-primary-soft"
                              : deck.category === "minor" ? "bg-surface-3 text-foreground"
                              : "bg-surface-2 text-muted-foreground"
                          }`}>{deck.category}</span>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
