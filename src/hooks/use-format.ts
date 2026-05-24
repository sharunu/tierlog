"use client";

import { useState, useEffect } from "react";
import { DEFAULT_GAME, GAMES, type GameSlug } from "@/lib/games";
import { useGameOptional } from "@/lib/games/context";

/**
 * 現ゲームのフォーマット状態（AD/ND や RANKED/RANDOM など）を localStorage で保持。
 * - ゲームコンテキスト未提供時は DEFAULT_GAME (dm) を使う
 * - localStorage キーはゲーム別: selectedFormat:${gameSlug}
 * - 旧キー 'selectedFormat' があれば 'selectedFormat:dm' に自動移行
 */

export type Format = string;

function readInitialFormat(gameSlug: GameSlug): string {
  if (typeof window === "undefined") return GAMES[gameSlug].defaultFormat ?? "";
  try {
    // 旧キー移行: 'selectedFormat' があり 'selectedFormat:dm' が無ければ 'dm' に移す
    if (gameSlug === "dm") {
      const legacy = window.localStorage.getItem("selectedFormat");
      const current = window.localStorage.getItem("selectedFormat:dm");
      if (legacy && !current && (legacy === "AD" || legacy === "ND")) {
        window.localStorage.setItem("selectedFormat:dm", legacy);
        window.localStorage.removeItem("selectedFormat");
        return legacy;
      }
    }
    const saved = window.localStorage.getItem(`selectedFormat:${gameSlug}`);
    const formats = GAMES[gameSlug].formats;
    if (saved && formats.some((f) => f.code === saved)) {
      return saved;
    }
  } catch {
    // ignore
  }
  return GAMES[gameSlug].defaultFormat ?? "";
}

export function useFormat() {
  const gameMeta = useGameOptional();
  const gameSlug: GameSlug = gameMeta?.slug ?? DEFAULT_GAME;

  const [format, setFormatState] = useState<string>(() => readInitialFormat(gameSlug));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // gameSlug (context) が変化したら、対応する localStorage キーから format を再 resolve する。
    // useGameOptional() の値 = 外部状態なので、effect 内で同期して setState する必要がある。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormatState(readInitialFormat(gameSlug));
    setReady(true);
  }, [gameSlug]);

  const setFormat = (f: string) => {
    setFormatState(f);
    try {
      window.localStorage.setItem(`selectedFormat:${gameSlug}`, f);
    } catch {
      // ignore
    }
  };

  return { format, setFormat, ready };
}
