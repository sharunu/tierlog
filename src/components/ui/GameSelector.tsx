"use client";

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { GAMES, GAME_SLUGS, type GameSlug } from "@/lib/games";

type Size = "large" | "small";

type Props = {
  currentGame: GameSlug;
  size?: Size;
  /**
   * 遷移先パスの組み立て関数。省略時は '/{slug}/home' へ遷移。
   * ゲーム切替時の同一ページ保持など要件に応じて上書き可能。
   */
  hrefFor?: (slug: GameSlug) => string;
};

export function GameSelector({ currentGame, size = "large", hrefFor }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = GAMES[currentGame];

  const handleSelect = (slug: GameSlug) => {
    setOpen(false);
    if (slug === currentGame) return;
    try {
      window.localStorage.setItem("selectedGame", slug);
      // eslint-disable-next-line react-hooks/immutability
      document.cookie = `selectedGame=${slug}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // ignore
    }
    const target = hrefFor ? hrefFor(slug) : `/${slug}/home`;
    router.push(target);
  };

  if (size === "small") {
    return (
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{current.shortName}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        {open && (
          <ul
            className="absolute right-0 top-full mt-1 w-max min-w-[200px] rounded-lg p-1 z-50"
            style={{
              backgroundColor: "#1a1d2e",
              border: "0.5px solid rgba(100,100,150,0.4)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
            role="listbox"
          >
            {GAME_SLUGS.map((slug) => {
              const g = GAMES[slug];
              const isActive = slug === currentGame;
              return (
                <li key={slug}>
                  <button
                    type="button"
                    onClick={() => handleSelect(slug)}
                    className={`w-full text-left px-3 py-2 text-xs rounded-md transition-colors ${
                      isActive
                        ? "bg-[#2a2d44] text-white font-medium"
                        : "text-gray-300 hover:bg-[#232640] hover:text-white"
                    }`}
                    role="option"
                    aria-selected={isActive}
                  >
                    {g.displayName}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">現在のゲーム</span>
          <span className="text-sm font-semibold text-foreground">{current.displayName}</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-muted-foreground">
          <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
      {open && (
        <ul
          className="absolute left-0 top-full mt-1 w-full rounded-xl p-1 z-50"
          style={{
            backgroundColor: "#1a1d2e",
            border: "0.5px solid rgba(100,100,150,0.4)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
          role="listbox"
        >
          {GAME_SLUGS.map((slug) => {
            const g = GAMES[slug];
            const isActive = slug === currentGame;
            return (
              <li key={slug}>
                <button
                  type="button"
                  onClick={() => handleSelect(slug)}
                  className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                    isActive
                      ? "bg-[#2a2d44] text-white font-medium"
                      : "text-gray-300 hover:bg-[#232640] hover:text-white"
                  }`}
                  role="option"
                  aria-selected={isActive}
                >
                  {g.displayName}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
