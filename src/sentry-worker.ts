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
// Plan B B-1 (2026-05-27): beforeSend scrubber / sendDefaultPii=false / release /
// environment 強化。public 公開前 PII / Bearer JWT / Supabase service_role key
// 流出リスク対策。
//
// 参照 (取得日 2026-05-25 / 追加 2026-05-27):
// - https://opennext.js.org/cloudflare/howtos/custom-worker
// - https://docs.sentry.io/platforms/javascript/guides/cloudflare/
// - https://docs.sentry.io/platforms/javascript/guides/cloudflare/configuration/options/
// - https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/

// .open-next/worker.js は opennextjs-cloudflare build 時に生成される .js。
// tsc の解決状況によって型エラーが出る場合があるため ts-ignore で抑制
// (ban-ts-comment ルールは本ファイルこの 1 行のみ disable)。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { default as handler } from "../.open-next/worker.js";
import * as Sentry from "@sentry/cloudflare";
import type { Breadcrumb, ErrorEvent, EventHint } from "@sentry/cloudflare";

interface CFVersionMetadata {
  id?: string;
  tag?: string;
  timestamp?: string;
}

interface SentryWorkerEnv {
  SENTRY_DSN?: string;
  NEXT_PUBLIC_SUPABASE_ENV?: string;
  CF_VERSION_METADATA?: CFVersionMetadata;
}

// Headers / URL query / request body 内の機微情報を伏字化する正規表現。
const SENSITIVE_HEADER_PATTERN = /^(authorization|cookie|set-cookie|x-internal-key|x-supabase-.*|apikey)$/i;
const SENSITIVE_QUERY_PARAMS = [
  "access_token",
  "refresh_token",
  "id_token",
  "provider_token",
  "provider_refresh_token",
  "code",
  "state",
  "apikey",
] as const;
const SENSITIVE_BODY_KEYS = /^(password|access_token|refresh_token|id_token|provider_token|provider_refresh_token|apikey|authorization|cookie)$/i;

const FILTERED = "[Filtered]";
const MAX_BODY_BYTES = 16 * 1024; // 16 KB
const MAX_BODY_DEPTH = 8;

function scrubHeadersRecord(
  headers: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!headers) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER_PATTERN.test(k) ? FILTERED : v;
  }
  return out;
}

function scrubUrl(input: string | undefined): string | undefined {
  if (!input) return input;
  try {
    const u = new URL(input, "http://placeholder.invalid");
    let changed = false;
    for (const k of SENSITIVE_QUERY_PARAMS) {
      if (u.searchParams.has(k)) {
        u.searchParams.set(k, FILTERED);
        changed = true;
      }
    }
    if (!changed) return input;
    // base が placeholder.invalid の場合は元 URL が relative だったので path+search だけ返す。
    if (u.host === "placeholder.invalid") {
      return `${u.pathname}${u.search}${u.hash}`;
    }
    return u.toString();
  } catch {
    return input;
  }
}

function scrubQueryString(query: string | undefined): string | undefined {
  if (!query) return query;
  try {
    const params = new URLSearchParams(query);
    let changed = false;
    for (const k of SENSITIVE_QUERY_PARAMS) {
      if (params.has(k)) {
        params.set(k, FILTERED);
        changed = true;
      }
    }
    return changed ? params.toString() : query;
  } catch {
    return query;
  }
}

function scrubBody(input: unknown, depth = 0): unknown {
  if (input == null) return input;
  if (depth > MAX_BODY_DEPTH) return FILTERED;
  if (Array.isArray(input)) {
    return input.map((v) => scrubBody(v, depth + 1));
  }
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SENSITIVE_BODY_KEYS.test(k) ? FILTERED : scrubBody(v, depth + 1);
    }
    return out;
  }
  return input;
}

function sizeOfBody(value: unknown): number {
  try {
    if (typeof value === "string") return value.length;
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}

function buildBeforeSend() {
  return (event: ErrorEvent, _hint: EventHint): ErrorEvent | null => {
    try {
      // 1. user 情報の二重防御削除 (sendDefaultPii: false でも明示)
      if (event.user) {
        delete event.user.email;
        delete event.user.username;
        delete event.user.ip_address;
      }
      // 2. request.headers
      if (event.request?.headers) {
        event.request.headers = scrubHeadersRecord(
          event.request.headers as Record<string, string>
        ) as typeof event.request.headers;
      }
      // 3. request.url / query_string
      if (event.request?.url) {
        event.request.url = scrubUrl(event.request.url);
      }
      if (event.request?.query_string) {
        event.request.query_string = scrubQueryString(
          event.request.query_string as string
        );
      }
      // 4. request.data (body)
      if (event.request?.data !== undefined && event.request.data !== null) {
        const size = sizeOfBody(event.request.data);
        if (size > MAX_BODY_BYTES) {
          event.request.data = FILTERED;
        } else if (typeof event.request.data === "string") {
          // string body は中身が JSON か form か不明なため、丸ごと伏字化に倒す。
          // (parse して個別 scrub するより安全側に倒すのが Plan B-1 の方針)
          event.request.data = FILTERED;
        } else {
          event.request.data = scrubBody(event.request.data);
        }
      }
      // 5. breadcrumbs (fetch / xhr の url + headers)
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b: Breadcrumb): Breadcrumb => {
          const next: Breadcrumb = { ...b };
          if (next.data) {
            const data = { ...next.data } as Record<string, unknown>;
            if (typeof data.url === "string") {
              data.url = scrubUrl(data.url);
            }
            if (data.request_headers && typeof data.request_headers === "object") {
              data.request_headers = scrubHeadersRecord(
                data.request_headers as Record<string, string>
              );
            }
            if (data.response_headers && typeof data.response_headers === "object") {
              data.response_headers = scrubHeadersRecord(
                data.response_headers as Record<string, string>
              );
            }
            next.data = data;
          }
          return next;
        });
      }
      // 6. extra / contexts に supabase URL/key が混入していないか軽くチェック
      // (現状は deep scrub せず、Supabase publishable key を含む場合のみ伏字化)
      if (event.extra && typeof event.extra === "object") {
        event.extra = scrubBody(event.extra) as typeof event.extra;
      }
    } catch (e) {
      // scrub が壊れた場合でも event を捨てない (Sentry に届くことを優先)。
      // ただし stack に scrub 例外を残さないために event は元のまま返す。
      console.warn("Sentry beforeSend scrub failed:", e);
    }
    return event;
  };
}

function resolveEnvironment(env: SentryWorkerEnv): string {
  // Runtime セクションに NEXT_PUBLIC_SUPABASE_ENV=staging が登録されていれば staging。
  // それ以外は production にフォールバック。
  return env.NEXT_PUBLIC_SUPABASE_ENV === "staging" ? "staging" : "production";
}

function resolveRelease(env: SentryWorkerEnv): string {
  // Cloudflare Workers の Version Metadata Binding (wrangler.jsonc で
  // version_metadata.binding = "CF_VERSION_METADATA" を設定済) から取得。
  // 未設定 / undefined の場合は "unknown" にフォールバック。
  return env.CF_VERSION_METADATA?.id ?? "unknown";
}

// Plan B (Codex 第 6 回): next.config.ts headers() で `noindex, nofollow, noarchive` の
// comma-separated 値が OpenNext / Cloudflare 経路で `noindex` にしか残らない事象を観測。
// Custom Worker entry (本ファイル) で response を wrap して per-host / per-path に
// X-Robots-Tag を強制付与する方が確実なので、こちらに統合する。
//
// 設計:
// - dev preview host (固定値 RD-B1) で全 path に noindex, nofollow, noarchive
// - /auth, /admin, /account, /api/*, /dm/*, /pokepoke/* に per-path で noindex 系
// - root `/` には noindex 系 header を付けない (default index)
// - 既存 response の X-Robots-Tag は上書きせず append しない (重複防止のため明示 set のみ)
//
// 注意:
// - Sentry.withSentry は ExportedHandler 形式の fetch を期待する。response wrapping は
//   handler.fetch を await した後 headers を書き換えてから返すラッパーで実装する。
// - response.headers が immutable な場合 (Cloudflare のキャッシュ済 response 等) は
//   new Response で wrap し直してから set。
const DEV_PREVIEW_HOST = "dev-duepure-tracker.jianrenzhongtian7.workers.dev";

function resolveRobotsTag(url: URL): string | null {
  const isDevPreview = url.hostname === DEV_PREVIEW_HOST;
  const path = url.pathname;

  if (path === "/auth" || path.startsWith("/auth/")) {
    return "noindex, nofollow, noarchive";
  }
  if (path === "/admin" || path.startsWith("/admin/")) {
    return "noindex, nofollow";
  }
  if (path === "/account" || path.startsWith("/account/")) {
    return "noindex, nofollow";
  }
  if (path === "/api" || path.startsWith("/api/")) {
    return "noindex";
  }
  if (path === "/dm" || path.startsWith("/dm/")) {
    return isDevPreview ? "noindex, nofollow, noarchive" : "noindex, nofollow";
  }
  if (path === "/pokepoke" || path.startsWith("/pokepoke/")) {
    return isDevPreview ? "noindex, nofollow, noarchive" : "noindex, nofollow";
  }
  if (isDevPreview) {
    // root / 法務 / share など dev preview の全 path に index 抑止 (RD-B1)。
    return "noindex, nofollow, noarchive";
  }
  return null;
}

function withRobotsHeader(request: Request, response: Response): Response {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return response;
  }
  const robotsValue = resolveRobotsTag(url);
  if (!robotsValue) return response;

  // 観測: response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive") の
  // comma-separated value が dev preview 経由で "noindex" だけに切り詰められる事象を確認。
  // Google 公式仕様 (https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag)
  // では `X-Robots-Tag: noindex, nofollow` 1 行と
  // 複数行 `X-Robots-Tag: noindex` + `X-Robots-Tag: nofollow` を **同等**に扱うため、
  // 同名 header を append で複数追加する形にして CDN 経路の comma split に依存しないようにする。
  // また独立した X-Tierlog-Robots header にも同じ値を入れて、CDN による X-Robots-Tag
  // 特有の rewrite を切り分け可能にする (運用上の debug 補助、不要なら今後削除)。
  const values = robotsValue.split(/,\s*/).filter(Boolean);

  const applyAll = (target: Headers) => {
    target.delete("X-Robots-Tag");
    for (const v of values) target.append("X-Robots-Tag", v);
    target.set("X-Tierlog-Robots", robotsValue);
  };

  try {
    applyAll(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    applyAll(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}

// Cloudflare Workers の ExecutionContext 互換 (waitUntil / passThroughOnException)。
// @cloudflare/workers-types を導入していないため、必要な surface のみ宣言する。
type WorkerExecutionContext = {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
};

// ExportedHandler 互換の fetch ラッパー。handler.fetch を呼び出した後、
// X-Robots-Tag を per-host / per-path で強制設定する。
// Sentry.withSentry は本 wrappedFetch を渡しても withSentry 内の例外計装は維持される。
const wrappedFetch = async (
  request: Request,
  env: SentryWorkerEnv,
  ctx: WorkerExecutionContext
): Promise<Response> => {
  const response = await handler.fetch(request, env, ctx);
  return withRobotsHeader(request, response);
};

export default Sentry.withSentry(
  (env: SentryWorkerEnv) => ({
    dsn: env.SENTRY_DSN,
    // Cloudflare の span duration 0ms 制約と Free tier 枠保護のため低めに固定。
    tracesSampleRate: 0.1,
    environment: resolveEnvironment(env),
    release: resolveRelease(env),
    // Plan B B-1: PII を sentry に送らない (cookie / IP / user agent 等)。
    // beforeSend と二重防御で運用する。
    sendDefaultPii: false,
    beforeSend: buildBeforeSend(),
  }),
  {
    fetch: wrappedFetch,
  },
);
