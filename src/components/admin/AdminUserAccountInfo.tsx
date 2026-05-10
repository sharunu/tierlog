"use client";

import { useEffect, useState } from "react";
import { getAdminUserDetail } from "@/lib/actions/admin-actions";
import type { AdminUserDetail } from "@/lib/actions/admin-actions";

export function AdminUserAccountInfo({ userId }: { userId: string }) {
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
      <div className="bg-surface-2 rounded-[10px] px-4 py-3 mb-4">
        <div className="flex justify-center py-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const providerLabel = detail.auth_provider === "google" ? "Google" : detail.auth_provider === "twitter" ? "X" : detail.auth_provider === "anonymous" ? "ゲスト" : "メール";

  return (
    <div className="space-y-3 mb-4">
      {/* ログイン・連携情報 */}
      <div className="bg-surface-2 rounded-[10px] px-4 py-3" style={{ border: "0.5px solid var(--border-subtle)" }}>
        <p className="text-[12px] text-gray-500 mb-2">アカウント情報</p>
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-gray-400">ログイン方法</span>
            <span>{providerLabel}</span>
          </div>
          {detail.email && (
            <div className="flex justify-between">
              <span className="text-gray-400">メール</span>
              <span className="truncate ml-4 text-right">{detail.email}</span>
            </div>
          )}
          {detail.x_username && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Xアカウント</span>
              <div className="flex items-center gap-2">
                <a
                  href={`https://x.com/${detail.x_username}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#1d9bf0] hover:underline"
                >@{detail.x_username}</a>
                {detail.x_user_id && <span className="text-[10px] text-gray-600">ID: {detail.x_user_id}</span>}
              </div>
            </div>
          )}
          {detail.discord_username && (
            <div className="flex justify-between">
              <span className="text-gray-400">Discord</span>
              <div className="flex items-center gap-2">
                <span>{detail.discord_username}</span>
                {detail.discord_id && <span className="text-[10px] text-gray-600">ID: {detail.discord_id}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
