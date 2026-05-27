"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getUserStage } from "@/lib/actions/account-actions";
import { Ban } from "lucide-react";
import { LoadingSpinner } from "@/components/layout/LoadingSpinner";

// BanGuard を bypass する公開ページ。
// - exact `/`: Plan B B-4 で SSR ランディング化、未ログインで閲覧可能 (RD-B8)
// - /auth: ログイン画面 (未認証ユーザーの導線)
// - /terms, /privacy: 法務文書 (ログイン不要の閲覧)
// - /contact: ログイン不要の問い合わせ窓口 (ban されたユーザーも到達できる必要あり)
// - /share: 共有 OG ページ (匿名アクセス想定)
//
// RD-B8: EXCLUDED_PATHS に `/` を単純追加すると `pathname.startsWith("/")` で
// 全 path bypass されて BanGuard が全停止するため、root は exact match で除外する。
const EXACT_PUBLIC_PATHS = ["/"] as const;
const PUBLIC_PREFIXES = ["/auth", "/terms", "/privacy", "/contact", "/share"] as const;

// auth/stage 取得失敗時のリトライ遅延 (ms)。1 回目 300ms、2 回目 800ms の固定 backoff。
const RETRY_DELAYS_MS = [300, 800] as const;

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function BanGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isBanned, setIsBanned] = useState<boolean | null>(null);

  // RD-B8: root は exact match、それ以外は path === p || pathname.startsWith(`${p}/`) で判定。
  // 例:
  //   pathname = "/"          → EXACT_PUBLIC_PATHS hit (excluded)
  //   pathname = "/auth"      → PUBLIC_PREFIXES の "/auth" と exact match (excluded)
  //   pathname = "/auth/callback" → pathname.startsWith("/auth/") で hit (excluded)
  //   pathname = "/dm/home"   → どの条件にも該当しない (NOT excluded)
  const isExcluded =
    (EXACT_PUBLIC_PATHS as readonly string[]).includes(pathname) ||
    PUBLIC_PREFIXES.some(p => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (isExcluded) {
      // EXCLUDED_PATHS (auth/terms/privacy/contact/share) では即座に isBanned=false を確定して
      // children を描画する。それ以外は下の supabase.auth.getUser() 等の非同期処理を
      // 待ってから setIsBanned する流れで、構造上 effect 内 setState が必要。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsBanned(false);
      return;
    }

    const controller = new AbortController();
    const supabase = createClient();

    const run = async () => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) {
          try {
            await abortableSleep(RETRY_DELAYS_MS[attempt - 1], controller.signal);
          } catch {
            return;
          }
        }
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (controller.signal.aborted) return;

          if (!user || user.is_anonymous) {
            if (user?.is_anonymous) {
              await supabase.auth.signOut();
            }
            window.location.href = "/auth";
            return;
          }

          const stage = await getUserStage();
          if (controller.signal.aborted) return;

          setIsBanned(stage === 4);
          return;
        } catch (e) {
          if (controller.signal.aborted) return;
          lastError = e;
        }
      }
      // リトライ全敗 → 最終 fail-open (UX 維持)。
      // 本当の ban / suspended / unpaid の強制は Plan D の DB/RLS/API access gate
      // で担保するため、ここで全画面停止しない (Supabase 一時障害で全ユーザー閉塞を避ける)。
      console.error("BanGuard auth/stage failed after retries:", lastError);
      if (!controller.signal.aborted) {
        setIsBanned(false);
      }
    };

    run();

    return () => controller.abort();
  }, [isExcluded]);

  if (isExcluded) return <>{children}</>;
  if (isBanned === null) return <LoadingSpinner />;

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
