// Sentry server-side init (Node.js runtime、OpenNext for Cloudflare Workers でも server 扱い)
//
// 方針 (plan §Resolved Decisions [Sentry env 分離] / [Sentry sourcemap]):
// - DSN が未設定なら init を呼ばない (dev / staging で Sentry を無効化する運用)
// - tracesSampleRate: 0.1 (Cloudflare の span duration 0ms 制約と Free tier 枠保護)
// - Session Replay は server では不要
//
// 参照:
// - https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/nextjs/
// - https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    debug: false,
  });
}
