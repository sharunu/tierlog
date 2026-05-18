"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DEFAULT_GAME, type GameSlug } from "@/lib/games";
import { useGameOptional } from "@/lib/games/context";

/**
 * 期間指定 (start/end) の状態管理 hook。
 *
 * 優先順位: URL `?start=` > localStorage `dateRangeStart:${gameSlug}` > default (1ヶ月前)
 *
 * - **URL は表示のみ (LS 不変)** — Resolved Decisions [URL→LS書込]:
 *   URL params が付いて開かれた場合、その値で描画はするが localStorage は書き換えない。
 *   共有リンクや詳細 URL を一度開いただけで、自分のゲーム別作業期間がリセットされる
 *   事故を防止する。localStorage 更新は `setStartDate` / `setRange` が呼ばれた時のみ。
 *
 * - 終了日は localStorage 保存しない (URL > 今日 のフォールバックのみ)。
 *
 * - localStorage キーはゲーム別: `dateRangeStart:${gameSlug}` (useFormat の命名規約を踏襲)。
 *
 * - GameProvider 配下で `useGameOptional()` から gameSlug を取得。
 *   未提供時は DEFAULT_GAME (`dm`) にフォールバック。
 */

const STORAGE_KEY = (game: GameSlug) => `dateRangeStart:${game}`;

function getDefaultStart(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString("sv-SE");
}

function getToday(): string {
  return new Date().toLocaleDateString("sv-SE");
}

export function useDateRange() {
  const gameMeta = useGameOptional();
  const gameSlug: GameSlug = gameMeta?.slug ?? DEFAULT_GAME;
  const searchParams = useSearchParams();

  // SSR safe: 初期値は default (URL / localStorage は mount 後に resolve)
  const [startDate, setStartDateState] = useState<string>(getDefaultStart);
  const [endDate, setEndDateState] = useState<string>(getToday);
  const [ready, setReady] = useState(false);

  // mount 時 / gameSlug 変化時 / URL params 変化時に再解決
  useEffect(() => {
    const urlStart = searchParams.get("start");
    const urlEnd = searchParams.get("end");

    let resolvedStart: string;
    if (urlStart) {
      // URL は今回の描画にのみ使う。localStorage は書き換えない (LS 不変方針)。
      resolvedStart = urlStart;
    } else {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY(gameSlug));
        resolvedStart = saved ?? getDefaultStart();
      } catch {
        resolvedStart = getDefaultStart();
      }
    }
    const resolvedEnd = urlEnd ?? getToday();

    // useFormat と同じパターン: URL params / localStorage を resolve するため、
    // 外部状態の同期は useEffect 内 setState が必要。set-state-in-effect rule を意図的に suppress する。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartDateState(resolvedStart);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEndDateState(resolvedEnd);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, [gameSlug, searchParams]);

  const setStartDate = (s: string) => {
    setStartDateState(s);
    try {
      window.localStorage.setItem(STORAGE_KEY(gameSlug), s);
    } catch {
      // ignore (private mode 等)
    }
  };

  // 終了日は localStorage に保存しない
  const setEndDate = (e: string) => setEndDateState(e);

  // DateRangeCalendar の onRangeChange(start, end) 用 (両方同時変更)
  const setRange = (s: string, e: string) => {
    setStartDate(s);
    setEndDate(e);
  };

  return { startDate, endDate, setStartDate, setEndDate, setRange, ready };
}
