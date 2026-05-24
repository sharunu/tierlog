"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Settings, Play } from "lucide-react";
import { getDetectionAlerts, resolveDetectionAlert, runDetectionScan, getAdminUserList } from "@/lib/actions/admin-actions";
import { GAMES, GAME_SLUGS, isGameSlug, type GameSlug } from "@/lib/games";

type Alert = {
  id: string;
  user_id: string;
  rule_key: string;
  details: Record<string, unknown> | null;
  is_resolved: boolean;
  created_at: string;
};

const ruleLabels: Record<string, string> = {
  extreme_winrate: "極端な勝率",
  rapid_input: "短時間大量入力",
  repetitive_pattern: "同一結果の連続",
};

type GameFilter = GameSlug | "all";

function DetectionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawGame = searchParams.get("game");
  const gameFilter: GameFilter = rawGame === "all" ? "all" : (isGameSlug(rawGame) ? rawGame : "all");
  const selectedGame: GameSlug | undefined = gameFilter === "all" ? undefined : gameFilter;

  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [userMap, setUserMap] = useState<Record<string, string>>({});
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const changeGame = (g: GameFilter) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("game", g);
    router.push(`/admin/detection?${params.toString()}`);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [alertData, users] = await Promise.all([
        getDetectionAlerts(showResolved, selectedGame),
        getAdminUserList(),
      ]);
      setAlerts(alertData as Alert[]);
      const map: Record<string, string> = {};
      for (const u of users as { id: string; display_name: string | null }[]) {
        map[u.id] = u.display_name || "名前未設定";
      }
      setUserMap(map);
    } catch {
      // error
    }
    setLoading(false);
  }, [showResolved, selectedGame]);

  // loadData は useCallback ラップ済で内部で setState 経由 fetch 反映。外部状態
  // (showResolved/selectedGame) 変化時の effect 内呼び出しが必要。
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadData(); }, [loadData]);

  const handleResolve = async (alertId: string) => {
    await resolveDetectionAlert(alertId);
    loadData();
  };

  const handleScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const count = await runDetectionScan();
      setScanResult(`スキャン完了: ${count}件のアラートを検知`);
      loadData();
    } catch {
      setScanResult("スキャンに失敗しました");
    }
    setScanning(false);
  };

  return (
    <div className="min-h-screen px-4 pt-6 pb-8 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => router.push("/admin")} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-[20px] font-medium">検知アラート</h1>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4 ml-7">
        毎日 04:30 JST に自動スキャンが実行されます。「今すぐスキャン」は即時確認用です。
      </p>

      {/* ゲームタブ */}
      <div className="flex gap-1 mb-4 border-b border-surface-2">
        <button
          type="button"
          onClick={() => changeGame("all")}
          className={`px-4 py-2 text-sm transition-colors -mb-px border-b-2 ${
            gameFilter === "all"
              ? "border-primary-soft text-foreground font-medium"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          全ゲーム
        </button>
        {GAME_SLUGS.map((g) => {
          const isActive = g === gameFilter;
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

      {/* アクションバー */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={handleScan}
          disabled={scanning}
          className="flex items-center gap-1.5 bg-primary text-primary-foreground rounded-[8px] px-3 py-2 text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Play size={14} />
          {scanning ? "実行中..." : "今すぐスキャン"}
        </button>
        <button
          onClick={() => router.push("/admin/detection/rules")}
          className="flex items-center gap-1.5 bg-surface-2 text-foreground rounded-[8px] px-3 py-2 text-[12px] font-medium hover:opacity-90"
          style={{ border: "0.5px solid var(--border-subtle)" }}
        >
          <Settings size={14} />
          ルール設定
        </button>
        <div className="ml-auto">
          <button
            onClick={() => setShowResolved(!showResolved)}
            className={`text-[11px] px-2.5 py-1 rounded-full ${showResolved ? "bg-primary text-primary-foreground" : "bg-surface-2 text-muted-foreground"}`}
          >
            {showResolved ? "全件" : "未解決のみ"}
          </button>
        </div>
      </div>

      {scanResult && (
        <p className={`text-[12px] mb-3 ${scanResult.includes("失敗") ? "text-destructive" : "text-success"}`}>
          {scanResult}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : alerts.length === 0 ? (
        <p className="text-center text-[13px] text-muted-foreground py-12">アラートはありません</p>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div key={alert.id} className="bg-surface-2 rounded-[10px] px-4 py-3">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full text-destructive font-medium" style={{ backgroundColor: "color-mix(in srgb, var(--destructive) 15%, transparent)" }}>
                    {ruleLabels[alert.rule_key] || alert.rule_key}
                  </span>
                  <p className="text-[13px] font-medium mt-1.5">
                    {userMap[alert.user_id] || alert.user_id.slice(0, 8)}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(alert.created_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              {/* 詳細展開 */}
              {alert.details && (
                <div className="text-[11px] text-muted-foreground bg-surface-1 rounded-[6px] px-3 py-2 mb-2">
                  {Object.entries(alert.details).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span>{k}</span>
                      <span className="text-muted-foreground">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => router.push(`/admin/users/${alert.user_id}`)}
                  className="text-[11px] text-primary-soft hover:underline"
                >
                  ユーザー詳細
                </button>
                {!alert.is_resolved && (
                  <button
                    onClick={() => handleResolve(alert.id)}
                    className="text-[11px] text-muted-foreground hover:text-foreground ml-auto"
                  >
                    対処済みにする
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DetectionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen px-4 pt-6 pb-8 max-w-lg mx-auto"><p className="text-muted-foreground text-sm">読み込み中...</p></div>}>
      <DetectionPageInner />
    </Suspense>
  );
}
