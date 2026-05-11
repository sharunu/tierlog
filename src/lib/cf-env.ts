/**
 * Cloudflare Workers runtime の Secret 型環境変数は process.env に露出しないため、
 * OpenNext の getCloudflareContext() 経由で取り出す。
 * EC2 Docker / ローカル dev など process.env が生きている環境もサポートするため
 * フォールバックも含める。
 *
 * 参考: https://opennext.js.org/cloudflare/bindings
 */

type CfEnv = Record<string, string | undefined>;

function resolveEnvKey(key: string, cfEnv: CfEnv): { key: string; allowFallback: boolean } {
  if (key !== "SUPABASE_SERVICE_ROLE_KEY") {
    return { key, allowFallback: true };
  }

  const supabaseEnv =
    (typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_SUPABASE_ENV : undefined) ??
    cfEnv.NEXT_PUBLIC_SUPABASE_ENV;
  const activeSupabaseUrl =
    (typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_SUPABASE_URL : undefined) ??
    cfEnv.NEXT_PUBLIC_SUPABASE_URL;
  const stagingSupabaseUrl =
    (typeof process !== "undefined" ? process.env?.STAGING_NEXT_PUBLIC_SUPABASE_URL : undefined) ??
    cfEnv.STAGING_NEXT_PUBLIC_SUPABASE_URL;

  if (
    supabaseEnv === "staging" ||
    (activeSupabaseUrl && stagingSupabaseUrl && activeSupabaseUrl === stagingSupabaseUrl)
  ) {
    return { key: "STAGING_SUPABASE_SERVICE_ROLE_KEY", allowFallback: false };
  }

  return { key, allowFallback: true };
}

export async function getServerEnv(key: string): Promise<string | undefined> {
  let cfEnv: CfEnv = {};

  try {
    const mod = await import("@opennextjs/cloudflare");
    const ctx = mod.getCloudflareContext?.();
    cfEnv = (ctx?.env ?? {}) as CfEnv;
  } catch {
    // OpenNext is not available in Node.js / local Next dev contexts.
  }

  const resolved = resolveEnvKey(key, cfEnv);

  // 1) process.env (Node.js / EC2 / NEXT_PUBLIC_* inline)
  const fromProcess = typeof process !== "undefined" ? process.env?.[resolved.key] : undefined;
  if (fromProcess) return fromProcess;

  // 2) getCloudflareContext().env (Cloudflare Workers runtime)
  const fromCloudflare = cfEnv[resolved.key];
  if (fromCloudflare) return fromCloudflare;

  if (!resolved.allowFallback) return undefined;

  const fallbackFromProcess = typeof process !== "undefined" ? process.env?.[key] : undefined;
  if (fallbackFromProcess) return fallbackFromProcess;

  return cfEnv[key];
}
