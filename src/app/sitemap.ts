import type { MetadataRoute } from "next";

// Codex 第 6 回: Cloudflare の env 値に trailing newline / whitespace が混入していて
// sitemap.xml / robots.txt の URL が host と path の間で改行されていた。
// 正規化 helper で trim + trailing slash 除去を行う。
function getNormalizedBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return raw.trim().replace(/\/+$/, "");
}

// Plan B B-4-c: ログイン必須の /{slug}/home は sitemap から除外し、
// 公開ランディング (`/`) と公開法務ページのみ掲載する。
// 個別 share は数が膨大かつ B-3-e で noindex 設定済のため掲載しない。
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getNormalizedBaseUrl();
  const now = new Date();

  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${base}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${base}/terms`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
    {
      url: `${base}/contact`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.5,
    },
  ];
}
