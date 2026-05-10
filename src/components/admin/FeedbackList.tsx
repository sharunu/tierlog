"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateFeedbackStatus, type AdminFeedback } from "@/lib/actions/admin-actions";

type Props = {
  feedbacks: AdminFeedback[];
};

const categoryConfig: Record<string, { label: string; color: string; bg: string }> = {
  bug: { label: "バグ", color: "var(--destructive)", bg: "color-mix(in srgb, var(--destructive) 12%, transparent)" },
  feature: { label: "機能要望", color: "var(--primary)", bg: "color-mix(in srgb, var(--primary) 12%, transparent)" },
  other: { label: "その他", color: "var(--muted-foreground)", bg: "color-mix(in srgb, var(--muted-foreground) 12%, transparent)" },
};

const categoryFilters = [
  { value: null, label: "全て" },
  { value: "bug", label: "バグ" },
  { value: "feature", label: "機能要望" },
  { value: "other", label: "その他" },
];

type StatusFilter = "pending" | "resolved" | null;

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "pending", label: "未処理" },
  { value: "resolved", label: "処理済み" },
  { value: null, label: "全て" },
];

export function FeedbackList({ feedbacks }: Props) {
  const router = useRouter();
  const [filter, setFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [localFeedbacks, setLocalFeedbacks] = useState<AdminFeedback[]>(feedbacks);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setLocalFeedbacks(feedbacks);
  }, [feedbacks]);

  useEffect(() => {
    const userIds = [...new Set(feedbacks.map(f => f.user_id).filter(Boolean))] as string[];
    if (userIds.length === 0) return;

    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds)
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const p of data ?? []) {
          map[p.id] = p.display_name || "名前未設定";
        }
        setUserNames(map);
      });
  }, [feedbacks]);

  const filtered = localFeedbacks
    .filter(f => filter ? f.category === filter : true)
    .filter(f => statusFilter ? f.status === statusFilter : true);

  const pendingCount = localFeedbacks.filter(f => f.status === "pending").length;

  const handleToggleStatus = async (fb: AdminFeedback) => {
    const next: "pending" | "resolved" = fb.status === "pending" ? "resolved" : "pending";
    setUpdating(prev => ({ ...prev, [fb.id]: true }));
    try {
      await updateFeedbackStatus(fb.id, next);
      setLocalFeedbacks(prev => prev.map(f => f.id === fb.id ? { ...f, status: next } : f));
    } catch (e) {
      console.error("Failed to update feedback status:", e);
    } finally {
      setUpdating(prev => ({ ...prev, [fb.id]: false }));
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {categoryFilters.map((f) => (
          <button
            key={f.value ?? "all"}
            onClick={() => setFilter(f.value)}
            className={`rounded-[20px] border px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-primary/15 text-primary border-transparent"
                : "bg-surface-2 text-muted-foreground border-transparent"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {statusFilters.map((f) => (
          <button
            key={f.value ?? "all"}
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-[20px] border px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === f.value
                ? "bg-warning/15 text-warning border-transparent"
                : "bg-surface-2 text-muted-foreground border-transparent"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="text-[11px] text-gray-500 ml-auto">未処理 {pendingCount}件</span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-12 text-sm">フィードバックがありません</p>
      ) : (
        <div className="space-y-3">
          {filtered.map((fb) => {
            const cat = categoryConfig[fb.category] ?? categoryConfig.other;
            const userName = fb.user_id ? (userNames[fb.user_id] ?? "...") : "退会済みユーザー";
            const date = fb.created_at ? new Date(fb.created_at) : null;
            const dateStr = date ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : "";

            return (
              <div key={fb.id} className="bg-surface-2 rounded-[10px] px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ color: cat.color, backgroundColor: cat.bg }}
                  >
                    {cat.label}
                  </span>
                  <span className="text-[11px] text-gray-500">{dateStr}</span>
                  <span className="text-[11px] text-gray-500 ml-auto truncate max-w-[120px]">{userName}</span>
                </div>
                <p className="text-[13px] text-foreground whitespace-pre-wrap break-words">{fb.message}</p>
                <div className="flex items-center gap-2 mt-3">
                  <button
                    onClick={() => handleToggleStatus(fb)}
                    disabled={updating[fb.id]}
                    className={`text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors disabled:opacity-50 ${
                      fb.status === "pending"
                        ? "bg-destructive/12 text-destructive hover:bg-destructive/20"
                        : "bg-primary/12 text-primary hover:bg-primary/20"
                    }`}
                  >
                    {fb.status === "pending" ? "未処理" : "処理済み"}
                  </button>
                  {fb.user_id ? (
                    <button
                      onClick={() => router.push(`/admin/users/${fb.user_id}`)}
                      className="text-[11px] text-primary hover:underline ml-auto"
                    >
                      詳細を見る &rsaquo;
                    </button>
                  ) : (
                    <span className="text-[11px] text-gray-600 ml-auto">退会済み</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
