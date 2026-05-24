"use client";

import { useEffect, useState, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  getOpponentDeckMasterList,
  getOpponentDeckSettings,
} from "@/lib/actions/admin-actions";
import { FormatSelector } from "@/components/ui/FormatSelector";
import { OpponentDeckManager } from "@/components/admin/OpponentDeckManager";
import { ChevronLeft } from "lucide-react";
import { DEFAULT_GAME, GAMES, GAME_SLUGS, isGameSlug, type GameSlug } from "@/lib/games";

type Settings = {
  management_mode: string;
  major_threshold: number;
  minor_threshold: number;
  usage_period_days: number;
  disable_period_days: number;
  classification_method: "threshold" | "fixed_count";
  major_fixed_count: number;
  minor_fixed_count: number;
  limitless_last_synced_at: string | null;
  limitless_last_sync_status: string | null;
  limitless_last_sync_message: string | null;
};

function AdminOpponentDecksInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawGame = searchParams.get("game");
  const game: GameSlug = isGameSlug(rawGame) ? rawGame : DEFAULT_GAME;

  const gameFormats = GAMES[game].formats;
  const defaultFormatForGame = GAMES[game].defaultFormat ?? "";

  // format は URL クエリ優先、無ければ game のデフォルト
  const rawFormat = searchParams.get("format");
  const format = rawFormat && gameFormats.some((f) => f.code === rawFormat)
    ? rawFormat
    : defaultFormatForGame;

  const setFormat = (f: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("format", f);
    params.set("game", game);
    router.push(`/admin/opponent-decks?${params.toString()}`);
  };

  const changeGame = (newGame: GameSlug) => {
    const newDefault = GAMES[newGame].defaultFormat ?? "";
    const params = new URLSearchParams();
    params.set("game", newGame);
    if (newDefault) params.set("format", newDefault);
    router.push(`/admin/opponent-decks?${params.toString()}`);
  };

  const [decks, setDecks] = useState<Awaited<ReturnType<typeof getOpponentDeckMasterList>>>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [applying, setApplying] = useState(false);
  const applyRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const loadDecks = useCallback(() => {
    setLoading(true);
    Promise.all([
      getOpponentDeckMasterList(format, game),
      getOpponentDeckSettings(format, game),
    ]).then(([d, s]) => {
      setDecks(d);
      setSettings(s as Settings | null);
      setLoading(false);
    });
  }, [format, game]);

  useEffect(() => {
    // loadDecks は useCallback ラップ済で内部で setState 経由 fetch 反映。
    // 外部状態 (format/game) 変化時の effect 内呼び出しが必要。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDecks();
  }, [loadDecks]);

  if (loading) {
    return (
      <div className="min-h-screen px-4 pt-6 pb-8 max-w-lg mx-auto">
        <p className="text-muted-foreground text-sm">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 pt-6 pb-8 max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/admin")} className="text-muted-foreground hover:text-foreground">
            <ChevronLeft size={20} />
          </button>
          <h1 className="text-[20px] font-medium">対面デッキ管理</h1>
        </div>
      </div>

      {/* ゲームタブ */}
      <div className="flex gap-1 mb-4 border-b border-surface-2">
        {GAME_SLUGS.map((g) => {
          const isActive = g === game;
          return (
            <button
              key={g}
              type="button"
              onClick={() => changeGame(g)}
              className={`px-4 py-2 text-sm transition-colors -mb-px border-b-2 ${
                isActive
                  ? "border-primary-soft text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {GAMES[g].shortName}
            </button>
          );
        })}
      </div>

      <div className="bg-surface-2 rounded-[10px] px-4 py-3 mb-4 flex items-center gap-3">
        <div className="flex-1">
          <FormatSelector format={format} setFormat={setFormat} game={game} />
        </div>
        <button
            onClick={() => applyRef.current?.()}
            disabled={!dirty || applying}
            className="bg-primary text-primary-foreground rounded-[8px] px-4 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50 transition-colors whitespace-nowrap min-h-[40px]"
          >
            {applying ? "反映中..." : "変更内容反映"}
          </button>
      </div>
      <OpponentDeckManager
        initialDecks={decks}
        format={format}
        initialSettings={settings}
        onDirtyChange={setDirty}
        onApplyingChange={setApplying}
        applyRef={applyRef}
        game={game}
      />
    </div>
  );
}

export default function AdminOpponentDecksPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-4 pt-6 pb-8 max-w-lg mx-auto"><p className="text-muted-foreground text-sm">読み込み中...</p></div>}>
      <AdminOpponentDecksInner />
    </Suspense>
  );
}
