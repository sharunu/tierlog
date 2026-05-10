"use client";

import { useEffect, useState } from "react";
import { getAdminUserDetail } from "@/lib/actions/admin-actions";
import type { AdminUserDetail } from "@/lib/actions/admin-actions";

export function AdminUserHome({ userId }: { userId: string }) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminUserDetail(userId)
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!detail) return <p className="text-center text-muted-foreground py-8 text-sm">情報を取得できませんでした</p>;

  return (
    <div className="space-y-3">
      {/* 所属サーバー */}
      {detail.teams && detail.teams.length > 0 ? (
        <div className="bg-surface-2 rounded-[10px] px-4 py-3" style={{ border: "0.5px solid var(--border-subtle)" }}>
          <p className="text-[12px] text-gray-500 mb-2">所属サーバー（{detail.teams.length}件）</p>
          <div className="space-y-3">
            {detail.teams.map((team) => (
              <div key={team.team_id}>
                <div className="flex items-center gap-2 mb-1">
                  {team.icon_url ? (
                    <img src={team.icon_url} alt="" className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-muted/30 flex items-center justify-center text-[10px] text-muted-foreground">
                      {team.team_name.charAt(0)}
                    </div>
                  )}
                  <span className="text-[13px] font-medium">{team.team_name}</span>
                  <span className="text-[10px] text-gray-600">({team.members.length}人)</span>
                </div>
                <div className="pl-7 flex flex-wrap gap-1">
                  {team.members.map((m, i) => (
                    <span key={i} className="text-[11px] text-gray-400 bg-surface-1 rounded px-1.5 py-0.5">
                      {m.discord_username}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-center text-muted-foreground py-8 text-sm">所属サーバーなし</p>
      )}
    </div>
  );
}
