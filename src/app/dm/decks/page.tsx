"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getDecks } from "@/lib/actions/deck-actions";
import { getOpponentDeckSuggestions } from "@/lib/actions/battle-actions";
import { useFormat } from "@/hooks/use-format";
import { FormatSelector } from "@/components/ui/FormatSelector";
import { DeckList } from "./DeckList";
import { handleAuthExpiredError } from "@/lib/errors/auth-expired-error";

export default function DecksPage() {
  const router = useRouter();
  const { format, setFormat, ready } = useFormat();
  const [decks, setDecks] = useState<Awaited<ReturnType<typeof getDecks>>>([]);
  const [suggestions, setSuggestions] = useState<{ major: string[]; minor: string[]; other: string[] }>({ major: [], minor: [], other: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    // ready/format 変化時に loading を同期 reset して再 fetch。Promise.all の .then() は
    // effect 外で setState するためそちらは警告対象外。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    Promise.all([getDecks(format), getOpponentDeckSuggestions(format)]).then(
      ([d, s]) => {
        setDecks(d);
        setSuggestions(s);
        setLoading(false);
      }
    ).catch((e) => {
      // Plan D / D-5 経路 1
      if (handleAuthExpiredError(e)) return;
      setError("データの読み込みに失敗しました");
      setLoading(false);
    });
  }, [format, ready]);

  return (
    <>
      <div className="min-h-screen pb-20 px-4 pt-6 max-w-lg mx-auto">
        <button
          onClick={() => router.push("/dm/battle")}
          className="text-sm text-primary hover:underline flex items-center gap-1 mb-3"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          対戦記録に戻る
        </button>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">使用デッキ管理</h1>
          <div className={!ready ? "invisible" : ""}>
            <FormatSelector format={format} setFormat={setFormat} />
          </div>
        </div>
        {error ? (
          <p className="text-center text-destructive py-12 text-sm">{error}</p>
        ) : (!ready || loading) ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : (
          <DeckList initialDecks={decks} format={format} suggestions={suggestions} />
        )}
      </div>
    </>
  );
}
