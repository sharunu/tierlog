// Sentry Next.js SDK の instrumentation hook (Next.js 16 標準)
// - server runtime (Node.js / OpenNext for Cloudflare Workers) では sentry.server.config を import
// - edge runtime (Next.js Edge Runtime) では sentry.edge.config を import
// - onRequestError は Next.js server-side error をキャプチャするための公式 hook
//
// 参照:
// - https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
// - https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
