// Custom Worker entry: Sentry × OpenNext for Cloudflare の統合点
//
// 方針 (plan §4-4 #6-b 案 B、spike report §5.2):
// - @sentry/nextjs の instrumentation.ts 経路は OpenNext の copyTracedFiles と
//   互換性問題があり (vercel/next.js#68740 で標準 standalone への
//   instrumentation.js コピーが漏れる)、ローカル build で 'File server/
//   instrumentation.js does not exist' エラーとなった。
// - そこで OpenNext 公式 docs (https://opennext.js.org/cloudflare/howtos/custom-worker)
//   の Custom Worker パターンに切り替え、.open-next/worker.js の fetch handler を
//   @sentry/cloudflare の withSentry でラップする。
// - これにより、OpenNext の copy 経路 (instrumentation.ts) に依存せず、Cloudflare
//   Workers ランタイムの例外を Sentry に送出できる。
//
// 参照 (取得日 2026-05-25):
// - https://opennext.js.org/cloudflare/howtos/custom-worker
// - https://docs.sentry.io/platforms/javascript/guides/cloudflare/
//
// 注意:
// - DSN は Cloudflare Variables and Secrets の Runtime セクション (Build セクション
//   ではない) に SENTRY_DSN として登録する必要がある。Build variable は OpenNext bundle
//   内部にしか届かない (process.env inline) ため、Custom Worker entry には届かない。
// - DSN が未設定 (env.SENTRY_DSN === undefined) の場合、Sentry.withSentry は
//   no-op として動作し、handler.fetch だけが透過される (Sentry SDK の安全側設計)。
// - 初期は browser/client 側 Sentry は導入しない (#6-b Resolved Decisions [Sentry env 分離] および
//   ユーザー指示)。client 側エラーは Cloudflare Workers Logs Engine で当面集約する。

// .open-next/worker.js は opennextjs-cloudflare build 時に生成される .js。
// tsc の解決状況によって型エラーが出る場合があるため ts-ignore で抑制
// (ban-ts-comment ルールは本ファイルこの 1 行のみ disable)。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { default as handler } from "../.open-next/worker.js";
import * as Sentry from "@sentry/cloudflare";

interface SentryWorkerEnv {
  SENTRY_DSN?: string;
  NEXT_PUBLIC_SUPABASE_ENV?: string;
}

export default Sentry.withSentry(
  (env: SentryWorkerEnv) => ({
    dsn: env.SENTRY_DSN,
    // Cloudflare の span duration 0ms 制約と Free tier 枠保護のため低めに固定。
    tracesSampleRate: 0.1,
    environment: env.NEXT_PUBLIC_SUPABASE_ENV === "staging" ? "staging" : "production",
  }),
  {
    fetch: handler.fetch,
  },
);
