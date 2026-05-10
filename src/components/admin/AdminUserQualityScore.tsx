"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getQualityScoreSnapshot,
  getQualityAdminBonus,
  getQualityScoreThreshold,
  upsertQualityAdminBonus,
  deleteQualityAdminBonus,
  calculateSingleUserScore,
} from "@/lib/actions/admin-actions";

const ruleDisplayNames: Record<string, string> = {
  x_linked: "X連携済み",
  discord_linked: "Discord連携済み",
  throwaway_suspect: "捨てアカウント疑い",
  long_term_user: "長期利用ユーザー",
  recent_battles: "直近の活動量",
  opponent_diversity: "対面デッキ多様性",
  normal_winrate: "適正な勝率",
  normal_input_pace: "適正な入力ペース",
  unresolved_alerts: "未解決アラートあり",
  extreme_winrate_q: "極端な勝率",
  repetitive_pattern_q: "反復パターン",
  excessive_input: "過度な入力",
  admin_bonus: "管理者ボーナス",
};

export function AdminUserQualityScore({ userId }: { userId: string }) {
  const [snapshot, setSnapshot] = useState<{
    total_score: number;
    breakdown: Record<string, number>;
    calculated_at: string;
  } | null>(null);
  const [bonus, setBonus] = useState<{
    score: number;
    memo: string | null;
  } | null>(null);
  const [threshold, setThreshold] = useState(40);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);

  // ボーナス編集
  const [editBonusScore, setEditBonusScore] = useState(0);
  const [editBonusMemo, setEditBonusMemo] = useState("");
  const [savingBonus, setSavingBonus] = useState(false);
  const [message, setMessage] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [snap, bon, thr] = await Promise.all([
        getQualityScoreSnapshot(userId),
        getQualityAdminBonus(userId),
        getQualityScoreThreshold(),
      ]);
      setSnapshot(snap as typeof snapshot);
      if (bon) {
        const b = bon as { score: number; memo: string | null };
        setBonus({ score: b.score, memo: b.memo });
        setEditBonusScore(b.score);
        setEditBonusMemo(b.memo || "");
      } else {
        setBonus(null);
        setEditBonusScore(0);
        setEditBonusMemo("");
      }
      setThreshold(thr);
    } catch {
      // error
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    setMessage("");
    try {
      const result = await calculateSingleUserScore(userId);
      setSnapshot({
        total_score: result.total_score,
        breakdown: result.breakdown,
        calculated_at: new Date().toISOString(),
      });
      setMessage("再計算しました（スナップショット更新は一括実行時）");
    } catch {
      setMessage("再計算に失敗しました");
    }
    setRecalculating(false);
    setTimeout(() => setMessage(""), 3000);
  };

  const handleSaveBonus = async () => {
    setSavingBonus(true);
    setMessage("");
    try {
      await upsertQualityAdminBonus(userId, editBonusScore, editBonusMemo);
      setBonus({ score: editBonusScore, memo: editBonusMemo });
      setMessage("ボーナスを保存しました");
    } catch {
      setMessage("保存に失敗しました");
    }
    setSavingBonus(false);
    setTimeout(() => setMessage(""), 2000);
  };

  const handleDeleteBonus = async () => {
    setSavingBonus(true);
    setMessage("");
    try {
      await deleteQualityAdminBonus(userId);
      setBonus(null);
      setEditBonusScore(0);
      setEditBonusMemo("");
      setMessage("ボーナスを削除しました");
    } catch {
      setMessage("削除に失敗しました");
    }
    setSavingBonus(false);
    setTimeout(() => setMessage(""), 2000);
  };

  if (loading) {
    return (
      <div className="bg-surface-2 rounded-[10px] px-4 py-4 mb-4">
        <div className="flex justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  const isQuality = snapshot ? snapshot.total_score >= threshold : false;
  const bonusLabel = bonus
    ? "現在 +" + bonus.score + "点 付与中" + (bonus.memo ? " (" + bonus.memo + ")" : "")
    : "未設定";

  return (
    <div className="space-y-3 mb-4">
      {/* スコアサマリ */}
      <div className="bg-surface-2 rounded-[10px] px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[14px] font-medium">品質スコア</p>
          {snapshot && (
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
              isQuality ? "bg-yellow-600/20 text-yellow-400" : "bg-gray-600/20 text-gray-400"
            }`}>
              {isQuality ? "優良" : "一般"}
            </span>
          )}
        </div>

        {snapshot ? (
          <>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-[28px] font-bold">{snapshot.total_score}</span>
              <span className="text-[13px] text-gray-500">/ {threshold}点</span>
            </div>

            {/* 内訳 */}
            <div className="bg-surface-1 rounded-[6px] px-3 py-2 mb-3">
              <p className="text-[11px] text-gray-500 mb-1.5">スコア内訳</p>
              {Object.entries(snapshot.breakdown).map(([key, value]) => (
                <div key={key} className="flex justify-between text-[12px] py-0.5">
                  <span className="text-gray-400">{ruleDisplayNames[key] || key}</span>
                  <span className={value >= 0 ? "text-green-400" : "text-red-400"}>
                    {value >= 0 ? "+" : ""}{value}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-gray-600">
              {"最終計算: " + new Date(snapshot.calculated_at).toLocaleString("ja-JP")}
            </p>
          </>
        ) : (
          <p className="text-[12px] text-gray-500">スコア未計算</p>
        )}

        <button
          onClick={handleRecalculate}
          disabled={recalculating}
          className="w-full mt-3 bg-primary text-primary-foreground rounded-[6px] px-3 py-2 text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {recalculating ? "計算中..." : "個別再計算"}
        </button>
      </div>

      {/* 管理者ボーナス */}
      <div className="bg-surface-2 rounded-[10px] px-4 py-4">
        <p className="text-[14px] font-medium mb-1">管理者ボーナス</p>
        <p className="text-[11px] text-gray-500 mb-3">{bonusLabel}</p>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[12px] text-gray-400">ボーナス値</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={editBonusScore}
                onChange={(e) => {
                  const num = parseInt(e.target.value);
                  if (!isNaN(num)) setEditBonusScore(num);
                }}
                className="w-20 bg-surface-1 rounded-[6px] px-2 py-1.5 text-[13px] text-right focus:outline-none"
                style={{ border: "0.5px solid var(--border)" }}
              />
              <span className="text-[11px] text-gray-500">点</span>
            </div>
          </div>
          <textarea
            value={editBonusMemo}
            onChange={(e) => setEditBonusMemo(e.target.value)}
            placeholder="理由メモ"
            className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[13px] focus:outline-none resize-none"
            style={{ border: "0.5px solid var(--border)", minHeight: 50 }}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSaveBonus}
              disabled={savingBonus}
              className="flex-1 bg-primary text-primary-foreground rounded-[6px] px-3 py-2 text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
            >
              {savingBonus ? "保存中..." : "保存"}
            </button>
            {bonus && (
              <button
                onClick={handleDeleteBonus}
                disabled={savingBonus}
                className="bg-surface-1 text-destructive rounded-[6px] px-3 py-2 text-[12px] font-medium hover:opacity-90 disabled:opacity-50"
                style={{ border: "0.5px solid var(--border)" }}
              >
                削除
              </button>
            )}
          </div>
        </div>

        {message && (
          <p className={`text-[11px] mt-2 ${message.includes("失敗") ? "text-red-400" : "text-green-400"}`}>{message}</p>
        )}
      </div>
    </div>
  );
}
