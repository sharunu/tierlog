"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getUserStage } from "@/lib/actions/account-actions";
import { Ban } from "lucide-react";

// BanGuard を bypass する公開ページ。
// - /auth: ログイン画面 (未認証ユーザーの導線)
// - /terms, /privacy: 法務文書 (ログイン不要の閲覧)
// - /contact: ログイン不要の問い合わせ窓口 (ban されたユーザーも到達できる必要あり)
// - /share: 共有 OG ページ (匿名アクセス想定)
const EXCLUDED_PATHS = ["/auth", "/terms", "/privacy", "/contact", "/share"];

export function BanGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isBanned, setIsBanned] = useState<boolean | null>(null);

  const isExcluded = EXCLUDED_PATHS.some(p => pathname.startsWith(p));

  useEffect(() => {
    if (isExcluded) {
      // EXCLUDED_PATHS (auth/terms/privacy/share) では即座に isBanned=false を確定して
      // children を描画する。それ以外は下の supabase.auth.getUser() 等の非同期処理を
      // 待ってから setIsBanned する流れで、構造上 effect 内 setState が必要。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsBanned(false);
      return;
    }

    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      // 未認証またはanonymousセッションの場合はログイン画面へ
      if (!user || user.is_anonymous) {
        if (user?.is_anonymous) {
          await supabase.auth.signOut();
        }
        window.location.href = "/auth";
        return;
      }
      const stage = await getUserStage();
      setIsBanned(stage === 4);
    });
  }, [isExcluded]);

  if (isExcluded) return <>{children}</>;
  if (isBanned === null) return null;

  if (isBanned) {
    const handleLogout = async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = "/auth";
    };

    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mx-auto">
            <Ban size={32} className="text-destructive" />
          </div>
          <h1 className="text-[18px] font-medium text-foreground">アカウントが停止されています</h1>
          <p className="text-[13px] text-muted-foreground">
            このアカウントは利用規約に違反したため停止されました。
          </p>
          <button
            onClick={handleLogout}
            className="w-full bg-surface-2 text-foreground rounded-[10px] px-4 py-3 text-[14px] font-medium hover:opacity-90"
            style={{ border: "0.5px solid var(--border-subtle)" }}
          >
            ログアウト
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
