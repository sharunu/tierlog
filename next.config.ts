import type { NextConfig } from "next";

// Content-Security-Policy:
// - 'unsafe-inline' in script-src は Next.js App Router の hydration script で必要 (nonce 化は別タスク)
// - cloudflareinsights.com は Web Analytics の script + beacon 送信先
// - Discord は OAuth が top-level navigation のため connect-src 不要
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://cdn.discordapp.com",
  "connect-src 'self' https://*.supabase.co https://cloudflareinsights.com https://static.cloudflareinsights.com",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");

// dev preview host を固定値で限定 (Plan B RD-B1):
// `.*workers.dev` のような広い regex は本番が同 subdomain の別 worker.dev URL を持つ場合に
// 誤発火する可能性があるため、必ず固定値の host にマッチさせる。
const DEV_PREVIEW_HOST = "dev-duepure-tracker.jianrenzhongtian7.workers.dev";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {},
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-XSS-Protection", value: "1; mode=block" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // preload は独自ドメイン運用が固まるまで外す (workers.dev は Cloudflare 側で preload 済み)
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
        { key: "Content-Security-Policy", value: csp },
      ],
    },
    // Plan B RD-B1: dev preview host 限定で X-Robots-Tag noindex を全 path に付与する。
    // 本番 (tierlog.app) には付かない。
    {
      source: "/:path*",
      has: [{ type: "host", value: DEV_PREVIEW_HOST }],
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    },
    // Plan B B-3-a: sensitive / app-internal path は本番 / dev preview 双方で
    // X-Robots-Tag header で noindex を強制する。
    // /auth は noarchive まで付与 (ログイン画面の検索結果残置を防ぐ)。
    {
      source: "/auth/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    },
    {
      source: "/auth",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      ],
    },
    {
      source: "/admin/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      source: "/admin",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      source: "/account/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      source: "/account",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      source: "/api/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex" },
      ],
    },
    // Plan B RD-B9: アプリ内部 page (/dm/* /pokepoke/*) の index 抑止。
    // robots.ts の Disallow は /dm /pokepoke を含まないため header 必須。
    {
      source: "/dm/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
    {
      source: "/pokepoke/:path*",
      headers: [
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ],
    },
  ],
};

export default nextConfig;
