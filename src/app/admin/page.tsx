"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Users, MessageSquare, Swords, ShieldAlert, Star, Settings } from "lucide-react";
import { getDetectionAlertCount } from "@/lib/actions/admin-actions";

const cards = [
  { title: "対面デッキ管理", description: "対面デッキの追加・編集・並べ替え", href: "/admin/opponent-decks", icon: Swords },
  { title: "ユーザー閲覧", description: "ユーザーのデッキ・履歴・分析を閲覧", href: "/admin/users", icon: Users },
  { title: "フィードバック", description: "ユーザーからのご意見・バグ報告", href: "/admin/feedback", icon: MessageSquare },
  { title: "一般", description: "共有データ保存期間・期限切れ削除", href: "/admin/general-settings", icon: Settings },
];

export default function AdminDashboardPage() {
  const router = useRouter();
  const [alertCount, setAlertCount] = useState<number>(0);

  useEffect(() => {
    getDetectionAlertCount().then(setAlertCount).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen px-4 pt-6 pb-8 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.push("/account")} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-[20px] font-medium">管理者画面</h1>
      </div>

      <div className="space-y-3">
        {/* 検知アラート */}
        <button
          onClick={() => router.push("/admin/detection")}
          className="w-full bg-surface-2 rounded-[10px] px-4 py-4 flex items-center gap-4 text-left hover:bg-surface-3 transition-colors"
        >
          <div className="w-10 h-10 rounded-[8px] flex items-center justify-center shrink-0 relative" style={{ backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)" }}>
            <ShieldAlert size={20} className="text-destructive" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-destructive text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {alertCount > 9 ? "9+" : alertCount}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-medium">検知アラート</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">
              {alertCount > 0 ? `未解決 ${alertCount}件` : "不正検知・アラート管理"}
            </p>
          </div>
          <span className="text-muted-foreground text-[18px] ml-auto shrink-0">&rsaquo;</span>
        </button>


        {/* 品質スコアリング */}
        <button
          onClick={() => router.push("/admin/quality-scoring")}
          className="w-full bg-surface-2 rounded-[10px] px-4 py-4 flex items-center gap-4 text-left hover:bg-surface-3 transition-colors"
        >
          <div className="w-10 h-10 rounded-[8px] flex items-center justify-center shrink-0" style={{ backgroundColor: "color-mix(in srgb, var(--warning) 10%, transparent)" }}>
            <Star size={20} className="text-warning" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-medium">品質スコアリング</p>
            <p className="text-[12px] text-muted-foreground mt-0.5">優良ユーザーの自動判定・ルール管理</p>
          </div>
          <span className="text-muted-foreground text-[18px] ml-auto shrink-0">&rsaquo;</span>
        </button>

        {cards.map((card) => (
          <button
            key={card.href}
            onClick={() => router.push(card.href)}
            className="w-full bg-surface-2 rounded-[10px] px-4 py-4 flex items-center gap-4 text-left hover:bg-surface-3 transition-colors"
          >
            <div className="w-10 h-10 rounded-[8px] bg-primary/10 flex items-center justify-center shrink-0">
              <card.icon size={20} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-medium">{card.title}</p>
              <p className="text-[12px] text-muted-foreground mt-0.5">{card.description}</p>
            </div>
            <span className="text-muted-foreground text-[18px] ml-auto shrink-0">&rsaquo;</span>
          </button>
        ))}
      </div>
    </div>
  );
}
