"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { getAdminUserList, type AdminUserListRow } from "@/lib/actions/admin-actions";

type StageFilter = "all" | 1 | 2 | 3 | 4;
type ProviderFilter = "all" | "google" | "twitter" | "anonymous" | "email";
type XConnectionFilter = "all" | "connected" | "not_connected";

const stageLabels: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: "優良", color: "var(--success)", bg: "color-mix(in srgb, var(--success) 12%, transparent)" },
  2: { label: "一般", color: "var(--muted-foreground)", bg: "color-mix(in srgb, var(--muted-foreground) 12%, transparent)" },
  3: { label: "要注意", color: "var(--warning)", bg: "color-mix(in srgb, var(--warning) 12%, transparent)" },
  4: { label: "BAN", color: "var(--destructive)", bg: "color-mix(in srgb, var(--destructive) 12%, transparent)" },
};

const providerLabel = (p: string): string => {
  if (p === "google") return "Google";
  if (p === "twitter") return "X";
  if (p === "anonymous") return "ゲスト";
  return "メール";
};

const normalizeProvider = (p: string): ProviderFilter => {
  if (p === "google" || p === "twitter" || p === "anonymous") return p;
  return "email";
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUserListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [xConnectionFilter, setXConnectionFilter] = useState<XConnectionFilter>("all");

  useEffect(() => {
    getAdminUserList()
      .then((data) => setUsers(data))
      .catch((e) => console.error("Failed to load users:", e))
      .finally(() => setLoading(false));
  }, []);

  const filtered = users
    .filter((u) => stageFilter === "all" ? true : u.stage === stageFilter)
    .filter((u) => providerFilter === "all" ? true : normalizeProvider(u.auth_provider) === providerFilter)
    .filter((u) => {
      if (xConnectionFilter === "all") return true;
      const connected = Boolean(u.x_user_id || u.x_username);
      return xConnectionFilter === "connected" ? connected : !connected;
    })
    .filter((u) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        (u.display_name?.toLowerCase().includes(q)) ||
        (u.email?.toLowerCase().includes(q)) ||
        (u.x_username?.toLowerCase().includes(q))
      );
    });

  return (
    <div className="min-h-screen px-4 pt-6 pb-8 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/admin")} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-[20px] font-medium">ユーザー一覧</h1>
        <span className="text-[12px] text-muted-foreground ml-auto">{filtered.length}/{users.length}人</span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <select
          value={stageFilter === "all" ? "all" : String(stageFilter)}
          onChange={(e) => setStageFilter(e.target.value === "all" ? "all" : Number(e.target.value) as StageFilter)}
          className="bg-surface-1 rounded-[6px] px-2 py-2 text-[12px] focus:outline-none text-foreground"
          style={{ border: "0.5px solid var(--border)" }}
        >
          <option value="all">全ステージ</option>
          <option value="1">優良</option>
          <option value="2">一般</option>
          <option value="3">要注意</option>
          <option value="4">BAN</option>
        </select>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value as ProviderFilter)}
          className="bg-surface-1 rounded-[6px] px-2 py-2 text-[12px] focus:outline-none text-foreground"
          style={{ border: "0.5px solid var(--border)" }}
        >
          <option value="all">全ログイン方法</option>
          <option value="google">Google</option>
          <option value="twitter">X</option>
          <option value="anonymous">ゲスト</option>
          <option value="email">メール</option>
        </select>
        <select
          value={xConnectionFilter}
          onChange={(e) => setXConnectionFilter(e.target.value as XConnectionFilter)}
          className="bg-surface-1 rounded-[6px] px-2 py-2 text-[12px] focus:outline-none text-foreground"
          style={{ border: "0.5px solid var(--border)" }}
        >
          <option value="all">X連携 全て</option>
          <option value="connected">X連携あり</option>
          <option value="not_connected">X連携なし</option>
        </select>
      </div>

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-surface-2 rounded-[8px] pl-9 pr-3 py-2.5 text-[13px] focus:outline-none"
          style={{ border: "0.5px solid var(--border)" }}
          placeholder="名前・メールで検索"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-muted-foreground py-12 text-sm">該当するユーザーがいません</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((u) => {
            const displayName = u.display_name || u.email || "名前未設定";
            const date = new Date(u.created_at);
            const dateStr = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
            const stage = stageLabels[u.stage];

            return (
              <button
                key={u.id}
                onClick={() => router.push(`/admin/users/${u.id}`)}
                className="w-full bg-surface-2 rounded-[10px] px-4 py-3 flex items-center gap-3 text-left hover:bg-surface-3 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium truncate">{displayName}</span>
                    {u.is_guest && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full text-muted-foreground shrink-0" style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 12%, transparent)" }}>
                        ゲスト
                      </span>
                    )}
                    {!u.is_guest && stage && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ color: stage.color, backgroundColor: stage.bg }}
                      >
                        {stage.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] text-gray-500">{dateStr} 登録</span>
                    <span className="text-[11px] text-gray-500">{u.battle_count}戦</span>
                    <span className="text-[10px] text-gray-600">{providerLabel(u.auth_provider)}</span>
                  </div>
                  {u.x_username && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[11px] text-[#1d9bf0]"
                        onClick={(e) => { e.stopPropagation(); window.open(`https://x.com/${u.x_username}`, '_blank'); }}
                      >@{u.x_username}</span>
                      {u.x_user_id && <span className="text-[10px] text-gray-600">(ID: {u.x_user_id})</span>}
                    </div>
                  )}
                </div>
                <span className="text-gray-500 text-[18px] shrink-0">&rsaquo;</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
