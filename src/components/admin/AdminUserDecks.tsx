"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { getAdminUserDecks } from "@/lib/actions/admin-actions";
import { DEFAULT_GAME, type GameSlug } from "@/lib/games";

type Tuning = { id: string; name: string; sort_order: number };
type Deck = { id: string; name: string; sort_order: number; deck_tunings: Tuning[] };

type Props = {
  userId: string;
  format: string;
  game?: GameSlug;
};

export function AdminUserDecks({ userId, format, game = DEFAULT_GAME }: Props) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedDeck, setExpandedDeck] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAdminUserDecks(userId, format, game).then((data) => {
      setDecks(data as Deck[]);
      setLoading(false);
    }).catch(() => {
      setError("データの読み込みに失敗しました");
      setLoading(false);
    });
  }, [userId, format, game]);

  if (error) {
    return <p className="text-center text-red-400 py-12 text-sm">{error}</p>;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (decks.length === 0) {
    return <p className="text-center text-muted-foreground py-12 text-sm">デッキがありません</p>;
  }

  return (
    <div className="space-y-2">
      {decks.map((deck) => {
        const isExpanded = expandedDeck === deck.id;
        const hasTunings = deck.deck_tunings.length > 0;

        return (
          <div key={deck.id} className="bg-surface-2 rounded-[10px] overflow-hidden">
            <button
              onClick={() => hasTunings && setExpandedDeck(isExpanded ? null : deck.id)}
              className={`w-full px-4 py-3 flex items-center gap-3 text-left ${hasTunings ? "cursor-pointer" : "cursor-default"}`}
            >
              {hasTunings ? (
                isExpanded ? <ChevronDown size={16} className="text-gray-500 shrink-0" /> : <ChevronRight size={16} className="text-gray-500 shrink-0" />
              ) : (
                <div className="w-4" />
              )}
              <span className="text-[14px] font-medium">{deck.name}</span>
              {hasTunings && (
                <span className="text-[11px] text-gray-500 ml-auto">{deck.deck_tunings.length}構築</span>
              )}
            </button>
            {isExpanded && hasTunings && (
              <div className="px-4 pb-3 pl-11">
                <div className="space-y-1">
                  {deck.deck_tunings.map((t) => (
                    <div key={t.id} className="text-[12px] text-[#8888aa] py-1 px-2 bg-[#1a1d2e] rounded-[4px]">
                      {t.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
