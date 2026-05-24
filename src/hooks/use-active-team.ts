"use client";

import { useCallback, useState, useEffect } from "react";

export function useActiveTeam() {
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("activeTeamId");
    if (saved) {
      // mount 時に localStorage から resolve した永続値を state に反映する典型パターン。
      // useFormat 等と同じく、SSR safe 初期値 (null) と client mount 後の resolve を分離するため
      // effect 内 setState が必要。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTeamIdState(saved);
    }
    setReady(true);
  }, []);

  const setActiveTeamId = useCallback((id: string | null) => {
    setActiveTeamIdState(id);
    if (id) {
      localStorage.setItem("activeTeamId", id);
    } else {
      localStorage.removeItem("activeTeamId");
    }
  }, []);

  return { activeTeamId, setActiveTeamId, ready };
}
