import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Content-Security-Policy:
// - 'unsafe-inline' in script-src は Next.js App Router の hydration script で必要 (nonce 化は別タスク)
// - cloudflareinsights.com は Web Analytics の script + beacon 送信先
// - *.ingest.sentry.io は Sentry SDK のイベント送信先 (server / browser とも)
// - Discord は OAuth が top-level navigation のため connect-src 不要
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://cdn.discordapp.com",
  "connect-src 'self' https://*.supabase.co https://cloudflareinsights.com https://static.cloudflareinsights.com https://*.ingest.sentry.io",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {},
  // @sentry/nextjs の OpenNext build エラー (#18843) を予防的に回避するため、
  // SDK の build 出力を Next.js のサーバ bundle に明示的に含める。
  outputFileTracingIncludes: {
    "*": ["node_modules/@sentry/nextjs/build/**/*"],
  },
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
  ],
};

// Sentry の build-time plugin。sourcemap upload は SENTRY_AUTH_TOKEN を Build secret に
// 登録していないため発生せず、log は silent。plan §Resolved Decisions [Sentry sourcemap] 参照
export default withSentryConfig(nextConfig, {
  silent: true,
});
