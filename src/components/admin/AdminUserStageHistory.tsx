"use client";

import { useState, useEffect } from "react";
import { getUserStageHistory } from "@/lib/actions/admin-actions";

const stageLabels: Record<number, { label: string; color: string }> = {
  1: { label: "優良", color: "text-yellow-400" },
  2: { label: "一般", color: "text-gray-400" },
  3: { label: "要注意", color: "text-orange-400" },
  4: { label: "BAN", color: "text-red-400" },
};

type HistoryEntry = {
  id: string;
  from_stage: number;
  to_stage: number;
  reason: string;
  changed_by: string;
  created_at: string;
};

export function AdminUserStageHistory({ userId }: { userId: string }) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUserStageHistory(userId)
      .then((data) => setHistory(data as HistoryEntry[]))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (history.length === 0) {
    return <p className="text-[13px] text-gray-500 text-center py-8">変更履歴はありません</p>;
  }

  return (
    <div className="space-y-3">
      <div className="text-[12px] text-gray-500">
        変更回数: {history.length}回
      </div>
      {history.map((h) => {
        const from = stageLabels[h.from_stage];
        const to = stageLabels[h.to_stage];
        return (
          <div key={h.id} className="bg-surface-2 rounded-[8px] px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[12px] ${from.color}`}>{from.label}</span>
              <span className="text-[12px] text-gray-600">→</span>
              <span className={`text-[12px] font-medium ${to.color}`}>{to.label}</span>
              <span className="text-[10px] text-gray-600 ml-auto">
                {new Date(h.created_at).toLocaleString("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            <p className="text-[12px] text-gray-400">{h.reason}</p>
          </div>
        );
      })}
    </div>
  );
}
