"use client";

import { useEffect, useState } from "react";
import { DEFAULT_GAME, isGameSlug, type GameSlug } from "@/lib/games";

/**
 * localStorage ベースで「前回選択したゲーム」を保持するフック。
 * ルートリダイレクト（/ → /{game}/home）や BottomNav の初期推定などに使う。
 * 現在のゲームを URL から取りたい場合は useGame() を使う。
 */
export function useSelectedGame(): { game: GameSlug; setGame: (g: GameSlug) => void; ready: boolean } {
  const [game, setGameState] = useState<GameSlug>(DEFAULT_GAME);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("selectedGame");
      if (isGameSlug(saved)) {
        // mount 時に localStorage から resolve した値を state に反映。SSR safe 初期値
        // (DEFAULT_GAME) と client mount 後の resolve を分離するための意図的な effect 内 setState。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setGameState(saved);
      }
    } catch {
      // ignore
    }
    setReady(true);
  }, []);

  const setGame = (g: GameSlug) => {
    setGameState(g);
    try {
      window.localStorage.setItem("selectedGame", g);
      document.cookie = `selectedGame=${g}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // ignore
    }
  };

  return { game, setGame, ready };
}
