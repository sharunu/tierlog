"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { updateUserStage } from "@/lib/actions/admin-actions";

const stageLabels: Record<number, { label: string; color: string }> = {
  1: { label: "優良", color: "bg-yellow-600/20 text-yellow-400" },
  2: { label: "一般", color: "bg-gray-600/20 text-gray-400" },
  3: { label: "要注意", color: "bg-orange-600/20 text-orange-400" },
  4: { label: "BAN", color: "bg-red-600/20 text-red-400" },
};

export function AdminUserStageControl({ userId }: { userId: string }) {
  const [currentStage, setCurrentStage] = useState<number>(2);
  const [newStage, setNewStage] = useState<number>(2);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("stage")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        const s = data?.stage ?? 2;
        setCurrentStage(s);
        setNewStage(s);
      });
  }, [userId]);

  const handleUpdate = async () => {
    if (!reason.trim()) {
      setMessage("理由を入力してください");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      await updateUserStage(userId, newStage, reason.trim());
      setCurrentStage(newStage);
      setReason("");
      setMessage("ステージを変更しました");
    } catch {
      setMessage("変更に失敗しました");
    }
    setLoading(false);
  };

  const info = stageLabels[currentStage];

  return (
    <div className="bg-surface-2 rounded-[10px] px-4 py-3 mb-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] text-gray-500">ステージ</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${info.color}`}>
          {info.label}
        </span>
      </div>
      <div className="space-y-2">
        <select
          value={newStage}
          onChange={(e) => setNewStage(Number(e.target.value))}
          className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[13px] focus:outline-none"
          style={{ border: "0.5px solid var(--border)" }}
        >
          <option value={1}>優良</option>
          <option value={2}>一般</option>
          <option value={3}>要注意</option>
          <option value={4}>BAN</option>
        </select>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="変更理由（必須）"
          className="w-full bg-surface-1 rounded-[6px] px-3 py-2 text-[13px] focus:outline-none resize-none"
          style={{ border: "0.5px solid var(--border)", minHeight: 60 }}
        />
        <button
          onClick={handleUpdate}
          disabled={loading || newStage === currentStage || !reason.trim()}
          className="w-full bg-primary text-primary-foreground rounded-[6px] px-3 py-2 text-[13px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          変更
        </button>
        {message && (
          <p className={`text-[11px] ${message.includes("失敗") ? "text-red-400" : "text-green-400"}`}>{message}</p>
        )}
      </div>
    </div>
  );
}
