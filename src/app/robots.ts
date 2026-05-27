import type { MetadataRoute } from "next";

// Codex 第 6 回: NEXT_PUBLIC_APP_URL の trailing newline で sitemap URL に改行混入した
// 事象があったため、robots.txt 側も同じ正規化を適用する。
function getNormalizedBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return raw.trim().replace(/\/+$/, "");
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/account", "/api", "/auth"],
    },
    sitemap: `${getNormalizedBaseUrl()}/sitemap.xml`,
  };
}
