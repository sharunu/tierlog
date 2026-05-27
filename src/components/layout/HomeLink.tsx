"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSelectedGame } from "@/hooks/use-selected-game";
import { resolveGameFromPath } from "@/lib/games";

type Props = {
  className?: string;
  style?: React.CSSProperties;
  label?: string;
};

export function HomeLink({ className, style, label = "ホームに戻る" }: Props) {
  const pathname = usePathname();
  const { game, ready } = useSelectedGame();

  const fromPath = resolveGameFromPath(pathname);

  if (fromPath) {
    return (
      <Link href={`/${fromPath}/home`} className={className} style={style}>
        {label}
      </Link>
    );
  }

  if (!ready) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        className={className}
        style={style}
      >
        <span className="inline-flex items-center justify-center gap-2">
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden
          />
          <span>読み込み中…</span>
        </span>
      </button>
    );
  }

  return (
    <Link href={`/${game}/home`} className={className} style={style}>
      {label}
    </Link>
  );
}
