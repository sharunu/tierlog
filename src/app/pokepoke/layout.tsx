import type { Metadata } from "next";
import { GAMES } from "@/lib/games";
import { GameLayoutClient } from "./GameLayoutClient";

const meta = GAMES.pokepoke;

// Plan B RD-B9 + Codex 第 6 回: アプリ内部 page は検索集客対象外なので nofollow / noindex を強制。
// X-Robots-Tag header の comma-separated 値が CDN 経路で `noindex` のみに切り詰められるため、
// `<meta name="robots">` で nofollow / noarchive を補完する設計に切替済。
// 本番では `noindex, nofollow`、dev preview build では `noindex, nofollow, noarchive` を出す。
const IS_STAGING_BUILD = process.env.NEXT_PUBLIC_SUPABASE_ENV === "staging";

export const metadata: Metadata = {
  title: {
    default: meta.trackerName,
    template: `%s | ${meta.trackerName}`,
  },
  description: meta.description,
  robots: IS_STAGING_BUILD
    ? { index: false, follow: false, noarchive: true }
    : { index: false, follow: false },
};

export default function PokepokeLayout({ children }: { children: React.ReactNode }) {
  return <GameLayoutClient game="pokepoke">{children}</GameLayoutClient>;
}
