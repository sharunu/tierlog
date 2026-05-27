import type { Metadata } from "next";
import { cookies } from "next/headers";
import { DEFAULT_GAME, isGameSlug } from "@/lib/games";
import { LandingHero } from "@/components/landing/LandingHero";

// Plan B RD-B6 (案 i): cookie 依存 permanentRedirect を廃止し、root を SSR
// 公開ランディングに置換。SSR HTML に意味のあるコンテンツを出すことで AdSense /
// 検索流入向けの要件を満たす。
// ログイン済みユーザーは「アプリを開く」CTA から /${game}/home へ 1 クリック遷移。
// BanGuard は RD-B8 の exact match で `/` を公開除外し、hydration 後も維持する。

export const metadata: Metadata = {
  title: "Tierlog — デュエプレ・ポケポケの対戦記録と環境分析",
  description:
    "デュエル・マスターズ プレイスとポケモンカードゲーム ポケットの対戦記録、環境統計、デッキ管理を 1 つのアプリで。X / Google ログインで無料で始められます。",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Tierlog — デュエプレ・ポケポケの対戦記録と環境分析",
    description: "デュエプレ・ポケポケの対戦記録と環境分析",
    images: [{ url: "/og-default.png", width: 1200, height: 630 }],
    type: "website",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tierlog",
    description: "デュエプレ・ポケポケの対戦記録と環境分析",
    images: ["/og-default.png"],
  },
  robots: { index: true, follow: true },
};

export default async function Home() {
  const cookieStore = await cookies();
  const saved = cookieStore.get("selectedGame")?.value;
  const defaultGame = isGameSlug(saved) ? saved : DEFAULT_GAME;
  return <LandingHero defaultGame={defaultGame} />;
}
