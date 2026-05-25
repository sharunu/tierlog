// Sentry browser/client-side init (Next.js Browser、Next.js 16 標準の instrumentation-client.ts)
//
// 方針 (plan §Resolved Decisions [Sentry env 分離]):
// - DSN が未設定なら init を呼ばない (dev / staging で Sentry を無効化する運用)
// - tracesSampleRate: 0.1
// - Session Replay は無効化 (replaysSessionSampleRate: 0 / replaysOnErrorSampleRate: 0)。
//   spike report §12 で Free tier の枠保護のため初期は disabled
//
// 参照:
// - https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
// - https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    debug: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
