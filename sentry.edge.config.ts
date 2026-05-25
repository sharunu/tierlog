// Sentry edge-runtime init (Next.js Edge Runtime)
//
// 方針 (plan §Resolved Decisions [Sentry env 分離] / [Sentry sourcemap]):
// - DSN が未設定なら init を呼ばない
// - server config と同じ tracesSampleRate
//
// 参照:
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
