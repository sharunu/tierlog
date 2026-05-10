"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, PlusCircle, BarChart3, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DEFAULT_GAME, isGameSlug, resolveGameFromPath, type GameSlug } from "@/lib/games";

type NavItem = {
  suffix: string;
  label: string;
  Icon: LucideIcon;
  ariaLabel: string;
};

const gameScopedItems: NavItem[] = [
  { suffix: "/home", label: "ホーム", Icon: Home, ariaLabel: "ホーム" },
  { suffix: "/battle", label: "対戦記録", Icon: PlusCircle, ariaLabel: "対戦記録" },
  { suffix: "/stats", label: "分析", Icon: BarChart3, ariaLabel: "分析" },
];

export function BottomNav() {
  const pathname = usePathname();
  const fromPath = resolveGameFromPath(pathname);
  const [cookieGame, setCookieGame] = useState<GameSlug | null>(null);

  useEffect(() => {
    if (fromPath) return;
    const match = document.cookie.match(/(?:^|; )selectedGame=([^;]+)/);
    if (match && isGameSlug(match[1])) {
      setCookieGame(match[1]);
    }
  }, [fromPath]);

  const game: GameSlug = fromPath ?? cookieGame ?? DEFAULT_GAME;
  const accountActive = pathname === "/account" || pathname?.startsWith("/account/") === true;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-surface-1 border-t border-border-subtle pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-[60px] max-w-lg mx-auto">
        {gameScopedItems.map((item) => {
          const href = `/${game}${item.suffix}`;
          const isActive = pathname === href || pathname?.startsWith(href + "/") === true;
          return (
            <Link
              key={item.suffix}
              href={href}
              aria-label={item.ariaLabel}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-col items-center justify-center min-w-[52px] min-h-[44px] transition-colors ${
                isActive ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.Icon size={20} strokeWidth={1.5} />
              <span className="text-[10px] mt-1">{item.label}</span>
              {isActive && <span className="w-1 h-1 rounded-full bg-primary mt-0.5" />}
            </Link>
          );
        })}
        <Link
          href="/account"
          aria-label="アカウント"
          aria-current={accountActive ? "page" : undefined}
          className={`flex flex-col items-center justify-center min-w-[52px] min-h-[44px] transition-colors ${
            accountActive ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <User size={20} strokeWidth={1.5} />
          <span className="text-[10px] mt-1">アカウント</span>
          {accountActive && <span className="w-1 h-1 rounded-full bg-primary mt-0.5" />}
        </Link>
      </div>
    </nav>
  );
}
