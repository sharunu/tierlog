import { Metadata } from "next";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getGameMetaBySlug, normalizeGameTitle } from "@/lib/games/server";
import { APP_BRAND } from "@/lib/games";
import { getServerEnv } from "@/lib/cf-env";
import {
  sanitizeShareImageUrl,
  normalizeSupabaseStoragePrefix,
} from "@/lib/share/image-url";

type Props = { params: Promise<{ id: string }> };

type ShareRow = {
  share_type: "stats" | "deck" | "opponent";
  share_data: Record<string, unknown>;
  image_url: string | null;
  game_title: string | null;
  user_id: string;
};

type LoadedShare = {
  share: ShareRow;
  allowedPrefixes: string[];
};

async function resolveAppUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host");
  if (host) {
    const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
    return `${protocol}://${host}`;
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "";
}

// DB の app_settings.storage_public_url_prefix を読む。service_role は同テーブルへの
// SELECT/INSERT/UPDATE/DELETE を grant 済 (migration 20260515000001)。
// migration 未適用などで行が存在しない場合は null を返し、env 由来 fallback に任せる。
async function loadStoragePublicUrlPrefix(
  supabase: SupabaseClient
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "storage_public_url_prefix")
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    if (typeof raw === "string" && raw.length > 0) return raw;
  } catch {
    // ignore: env fallback に任せる
  }
  return null;
}

async function resolveAllowedPrefixes(supabase: SupabaseClient): Promise<string[]> {
  const dbPrefix = await loadStoragePublicUrlPrefix(supabase);
  const envPrefix = normalizeSupabaseStoragePrefix(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const prefixes: string[] = [];
  if (dbPrefix) prefixes.push(dbPrefix);
  if (envPrefix && envPrefix !== dbPrefix) prefixes.push(envPrefix);
  return prefixes;
}

function resolveOgImageUrl(
  share: ShareRow,
  allowedPrefixes: string[],
  appUrl: string,
  id: string
): string {
  const safe = sanitizeShareImageUrl(share.image_url, {
    allowedPrefixes,
    shareUserId: share.user_id,
  });
  return safe ?? `${appUrl}/api/og/${id}`;
}

async function loadShare(id: string): Promise<LoadedShare | null> {
  const serviceRoleKey = await getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) return null;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false } }
  );
  const { data } = await supabase
    .from("shares")
    .select("share_type, share_data, image_url, game_title, user_id")
    .eq("id", id)
    .single();
  const share = (data as ShareRow | null) ?? null;
  if (!share) return null;

  // app_settings.storage_public_url_prefix を一次正として読み、
  // NEXT_PUBLIC_SUPABASE_URL 由来の正規化 prefix を二次 fallback に積む。
  // production code deploy → production migration 未適用時間帯では DB 行が無いため
  // env fallback だけで safe URL を表示できるようにしておく。
  const allowedPrefixes = await resolveAllowedPrefixes(supabase);
  return { share, allowedPrefixes };
}

function buildTitleAndDescription(share: ShareRow): { title: string; description: string } {
  const d = share.share_data as Record<string, unknown>;
  const dGame = (typeof d.game === "string" ? d.game : share.game_title) ?? "dm";
  const drawSuffix = dGame === "pokepoke" ? `${(d.totalDraws as number) ?? 0}分` : "";
  const wlText = `${d.totalWins}勝${d.totalLosses}敗${drawSuffix}`;
  const winRateText = d.winRate === null || d.winRate === undefined ? "--" : d.winRate;
  const period = (d.period as string) ?? "";
  const deckName = (d.deckName as string) ?? "";

  if (share.share_type === "stats") {
    return {
      title: `勝率 ${winRateText}% - 戦績サマリー`,
      description: `${wlText} | ${period}`,
    };
  }
  if (share.share_type === "deck") {
    return {
      title: `${deckName} 勝率 ${winRateText}%`,
      description: `${wlText} | ${period}`,
    };
  }
  return {
    title: `vs ${deckName} 勝率 ${winRateText}%`,
    description: `${wlText} | ${period}`,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadShare(id);

  if (!loaded) {
    return { title: APP_BRAND.name };
  }

  const { share, allowedPrefixes } = loaded;
  const appUrl = await resolveAppUrl();
  const ogImageUrl = resolveOgImageUrl(share, allowedPrefixes, appUrl, id);
  const gameMeta = getGameMetaBySlug(share.game_title);
  const { title, description } = buildTitleAndDescription(share);

  return {
    title: `${title} | ${gameMeta.trackerName}`,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default async function SharePage({ params }: Props) {
  const { id } = await params;
  const loaded = await loadShare(id);

  if (!loaded) {
    notFound();
  }

  const { share, allowedPrefixes } = loaded;
  const appUrl = await resolveAppUrl();
  const ogImageUrl = resolveOgImageUrl(share, allowedPrefixes, appUrl, id);
  const gameSlug = normalizeGameTitle(share.game_title);
  const gameMeta = getGameMetaBySlug(gameSlug);
  const { title, description } = buildTitleAndDescription(share);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
        <header className="flex items-center justify-between">
          <Link
            href={`/${gameSlug}/home`}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            {gameMeta.trackerName}
          </Link>
        </header>

        <h1 className="text-2xl font-bold leading-tight">{title}</h1>
        <p className="text-sm text-slate-300">{description}</p>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={ogImageUrl}
            alt={title}
            width={1200}
            height={630}
            className="h-auto w-full"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/${gameSlug}/home`}
            className="inline-flex flex-1 items-center justify-center rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400"
          >
            アプリで開く
          </Link>
          <Link
            href={`/auth?game=${gameSlug}&next=${encodeURIComponent(`/${gameSlug}/home`)}`}
            className="inline-flex flex-1 items-center justify-center rounded-xl border border-slate-700 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
          >
            ログイン / 新規登録
          </Link>
        </div>
      </div>
    </main>
  );
}
