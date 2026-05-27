import { getGameMetaBySlug } from "@/lib/games/server";
import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/cf-env";
import { sanitizeShareImageUrl } from "@/lib/share/image-url";

export const runtime = "nodejs";

type ShareRow = {
  share_type: "stats" | "deck" | "opponent";
  share_data: Record<string, unknown>;
  image_url: string | null;
  game_title: string | null;
  user_id: string;
};

const FONT_CACHE: { regular?: ArrayBuffer; bold?: ArrayBuffer } = {};

async function getFontFromGoogle(weight: 400 | 700): Promise<ArrayBuffer> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@${weight}&display=swap`,
    { headers: { "User-Agent": "Mozilla/5.0" } }
  ).then((res) => res.text());
  const match = css.match(/src: url\((.+?)\) format/);
  if (!match) throw new Error("Font URL not found");
  return fetch(match[1]).then((res) => res.arrayBuffer());
}

async function getFonts(): Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> {
  if (!FONT_CACHE.regular) FONT_CACHE.regular = await getFontFromGoogle(400);
  if (!FONT_CACHE.bold) FONT_CACHE.bold = await getFontFromGoogle(700);
  return { regular: FONT_CACHE.regular, bold: FONT_CACHE.bold };
}

const CHIP_COLORS = ["#818cf8", "#6366f1", "#38bdf8", "#34d399", "#fbbf24", "#64748b"];

type StatsData = {
  totalWins: number;
  totalLosses: number;
  totalDraws?: number;
  winRate: number | null;
  firstWins: number;
  firstLosses: number;
  firstDraws?: number;
  secondWins: number;
  secondLosses: number;
  secondDraws?: number;
  unknownWins?: number;
  unknownLosses?: number;
  unknownDraws?: number;
  encounterDistribution: { name: string; count: number; percentage: number; winRate?: number | null }[];
  period: string;
  format: string;
  game?: string;
};

type DeckData = {
  deckName: string;
  totalWins: number;
  totalLosses: number;
  totalDraws?: number;
  winRate: number | null;
  firstWins: number;
  firstLosses: number;
  firstDraws?: number;
  secondWins: number;
  secondLosses: number;
  secondDraws?: number;
  topMatchups: { name: string; wins: number; losses: number; draws?: number; winRate: number | null }[];
  period: string;
  format: string;
  game?: string;
};

function formatWLTJaOg(wins: number, losses: number, draws: number, game: string | undefined): string {
  return game === "pokepoke"
    ? `${wins}勝${losses}敗${draws}分`
    : `${wins}勝${losses}敗`;
}

function formatWLTOg(wins: number, losses: number, draws: number, game: string | undefined): string {
  return game === "pokepoke"
    ? `${wins}-${losses}-${draws}`
    : `${wins}-${losses}`;
}

function winRateColor(rate: number): string {
  if (rate < 0) return "#8a8fa3";
  if (rate >= 50) return "#5b8def";
  return "#e85d75";
}

function TurnRow({ label, color, wins, losses, draws, total, rate, game }: { label: string; color: string; wins: number; losses: number; draws: number; total: number; rate: number; game: string | undefined }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        width: "100%",
        height: 92,
        background: "#1a1d3a",
        borderRadius: 14,
        padding: "0 28px 0 0",
        borderLeft: `5px solid ${color}`,
        paddingLeft: 23,
        gap: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          fontSize: 20,
          fontWeight: 700,
          color: color,
          minWidth: 60,
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          fontSize: 54,
          fontWeight: 700,
          color: rate >= 0 ? winRateColor(rate) : "#55586e",
          minWidth: 150,
          lineHeight: 1,
        }}
      >
        {rate >= 0 ? `${rate}%` : "—"}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginLeft: "auto",
          alignItems: "flex-end",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "#d6dae8", display: "flex" }}>
          {total > 0 ? formatWLTOg(wins, losses, draws, game) : "—"}
        </div>
        <div style={{ fontSize: 12, fontWeight: 400, color: "#8a8fa3", marginTop: 2 }}>
          {total > 0 ? `${total}戦` : "0戦"}
        </div>
      </div>
    </div>
  );
}

function renderStatsOg(d: StatsData, appUrl: string, trackerName: string, gameTitle: string | undefined) {
  const game = d.game ?? gameTitle;
  const totalDraws = d.totalDraws ?? 0;
  const firstDraws = d.firstDraws ?? 0;
  const secondDraws = d.secondDraws ?? 0;
  const unknownWins = d.unknownWins ?? 0;
  const unknownLosses = d.unknownLosses ?? 0;
  const unknownDraws = d.unknownDraws ?? 0;
  const totalBattles = d.totalWins + d.totalLosses + totalDraws;
  const firstTotal = d.firstWins + d.firstLosses + firstDraws;
  const secondTotal = d.secondWins + d.secondLosses + secondDraws;
  const unknownTotal = unknownWins + unknownLosses + unknownDraws;
  const firstRate = (d.firstWins + d.firstLosses) > 0 ? Math.round((d.firstWins / (d.firstWins + d.firstLosses)) * 100) : -1;
  const secondRate = (d.secondWins + d.secondLosses) > 0 ? Math.round((d.secondWins / (d.secondWins + d.secondLosses)) * 100) : -1;
  const unknownRate = (unknownWins + unknownLosses) > 0 ? Math.round((unknownWins / (unknownWins + unknownLosses)) * 100) : -1;

  const heroColor = winRateColor(d.winRate ?? -1);
  const distribution = (d.encounterDistribution ?? []).slice(0, 5);

  return (
    <div
      style={{
        width: 1200,
        height: 630,
        background: "linear-gradient(135deg, #0b0d24 0%, #1a1d3a 55%, #0b0d24 100%)",
        color: "#fff",
        fontFamily: "NotoSansJP",
        padding: "36px 56px 26px 56px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: "linear-gradient(135deg, #818cf8 0%, #6366f1 100%)",
            }}
          />
          <div style={{ fontSize: 18, fontWeight: 700, color: "#cbd0e0", letterSpacing: 0.5 }}>
            {trackerName}
          </div>
          <div style={{ width: 1, height: 18, background: "#3a3d55" }} />
          <div style={{ fontSize: 15, fontWeight: 400, color: "#8a8fa3" }}>戦績サマリー</div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 400, color: "#8a8fa3" }}>{`${d.period} · ${d.format}`}</div>
      </div>

      {/* Main: Hero win rate + Turn stats stack */}
      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 56, marginTop: 16 }}>
        {/* Left: Hero win rate */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, alignItems: "flex-start", justifyContent: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 400, color: "#9aa0b4", letterSpacing: 2 }}>
            WIN RATE
          </div>
          <div
            style={{
              fontSize: 200,
              fontWeight: 700,
              color: heroColor,
              lineHeight: 1,
              display: "flex",
              marginTop: 4,
              letterSpacing: -4,
            }}
          >
            {d.winRate === null ? "--%" : `${d.winRate}%`}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 18 }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#e8eaf4", display: "flex" }}>
              {formatWLTJaOg(d.totalWins, d.totalLosses, totalDraws, game)}
            </div>
            <div style={{ fontSize: 18, fontWeight: 400, color: "#8a8fa3" }}>{`/ ${totalBattles}戦`}</div>
          </div>
        </div>

        {/* Right: Turn stats */}
        <div style={{ display: "flex", flexDirection: "column", width: 560, gap: 14 }}>
          <TurnRow label="先攻" color="#f0a030" wins={d.firstWins} losses={d.firstLosses} draws={firstDraws} total={firstTotal} rate={firstRate} game={game} />
          <TurnRow label="後攻" color="#5b8def" wins={d.secondWins} losses={d.secondLosses} draws={secondDraws} total={secondTotal} rate={secondRate} game={game} />
          <TurnRow label="不明" color="#8a8aa0" wins={unknownWins} losses={unknownLosses} draws={unknownDraws} total={unknownTotal} rate={unknownRate} game={game} />
        </div>
      </div>

      {/* Bottom: Matchup chips */}
      {distribution.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 20, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#818cf8", letterSpacing: 1.5 }}>
            MATCHUPS
          </div>
          {distribution.map((item, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                background: "rgba(26,29,58,0.7)",
                borderRadius: 999,
                border: "1px solid #2a2d48",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: CHIP_COLORS[i % CHIP_COLORS.length],
                }}
              />
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: "#d6dae8",
                  maxWidth: 130,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.name}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: item.winRate !== undefined && item.winRate !== null ? winRateColor(item.winRate) : "#9aa0b4",
                }}
              >
                {item.winRate !== undefined && item.winRate !== null ? `${item.winRate}%` : `${item.percentage}%`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 400, color: "#55586e", letterSpacing: 0.3 }}>{appUrl}</div>
      </div>
    </div>
  );
}

function renderDeckOg(d: DeckData, shareType: string, appUrl: string, trackerName: string, gameTitle: string | undefined) {
  const game = d.game ?? gameTitle;
  const totalDraws = d.totalDraws ?? 0;
  const firstDraws = d.firstDraws ?? 0;
  const secondDraws = d.secondDraws ?? 0;
  const totalBattles = d.totalWins + d.totalLosses + totalDraws;
  const firstRate = (d.firstWins + d.firstLosses) > 0 ? Math.round((d.firstWins / (d.firstWins + d.firstLosses)) * 100) : 0;
  const secondRate = (d.secondWins + d.secondLosses) > 0 ? Math.round((d.secondWins / (d.secondWins + d.secondLosses)) * 100) : 0;

  const title = shareType === "opponent" ? `vs ${d.deckName}` : d.deckName;
  const matchupLabel = shareType === "opponent" ? "使用デッキ別" : "対面別勝率";

  return (
    <div style={{ width: 1200, height: 630, background: "linear-gradient(135deg, #0f1129 0%, #1a1d3a 50%, #0f1129 100%)", color: "#fff", fontFamily: "NotoSansJP", padding: 44, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 14, fontWeight: 400, color: "#666", marginTop: 4 }}>{`${d.period} / ${d.format}`}</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 56, marginTop: 20 }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 72, fontWeight: 700, color: (d.winRate ?? 0) >= 50 ? "#5b8def" : "#e85d75" }}>{d.winRate === null ? "--%" : `${d.winRate}%`}</div>
          <div style={{ fontSize: 18, fontWeight: 400, color: "#999", marginTop: 4 }}>{`${formatWLTJaOg(d.totalWins, d.totalLosses, totalDraws, game)} / ${totalBattles}戦`}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 18 }}>
            <div style={{ color: "#aaa", width: 40, fontWeight: 400 }}>先攻</div>
            <div style={{ fontWeight: 700 }}>{`${firstRate}%`}</div>
            <div style={{ color: "#666", fontSize: 14, fontWeight: 400 }}>{`(${formatWLTOg(d.firstWins, d.firstLosses, firstDraws, game)})`}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 18 }}>
            <div style={{ color: "#aaa", width: 40, fontWeight: 400 }}>後攻</div>
            <div style={{ fontWeight: 700 }}>{`${secondRate}%`}</div>
            <div style={{ color: "#666", fontSize: 14, fontWeight: 400 }}>{`(${formatWLTOg(d.secondWins, d.secondLosses, secondDraws, game)})`}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", marginTop: 24, flex: 1 }}>
        <div style={{ fontSize: 14, color: "#818cf8", marginBottom: 12, fontWeight: 700 }}>{`${matchupLabel} Top5`}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {d.topMatchups.slice(0, 5).map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 16 }}>
              <div style={{ color: "#ccc", fontWeight: 400, overflow: "hidden", maxWidth: 500 }}>{m.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", fontWeight: 700, flexShrink: 0, marginLeft: 16 }}>
                <span>{m.winRate === null ? "--%" : `${m.winRate}%`}</span>
                <span style={{ color: "#666", fontSize: 13, fontWeight: 400, marginLeft: 4 }}>{`(${formatWLTOg(m.wins, m.losses, m.draws ?? 0, game)})`}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#818cf8" }}>{trackerName}</div>
        <div style={{ fontSize: 13, fontWeight: 400, color: "#555" }}>{appUrl}</div>
      </div>
    </div>
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const url = new URL(request.url);
  const appUrl = `${url.protocol}//${url.host}`;

  const serviceRoleKey = await getServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    return new Response("Server configuration error", { status: 500 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false } }
  );

  const { data: shareData } = await supabase
    .from("shares")
    .select("share_type, share_data, image_url, game_title, user_id")
    .eq("id", id)
    .single();

  const share = (shareData as ShareRow | null) ?? null;
  if (!share) {
    return new Response("Not found", { status: 404 });
  }

  // shares.image_url が Supabase Storage の share-images/<user_id>/... を指す
  // 正規 URL の場合のみ redirect、それ以外 (外部 URL / 他 user_id 配下 / 不正形式) は
  // null となり、次の next/og 自己生成にフォールスルー (Plan A A-1 display sanitizer)。
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const allowedPrefix = supabaseUrl
    ? `${supabaseUrl}/storage/v1/object/public/share-images/`
    : null;
  const safeImageUrl = allowedPrefix
    ? sanitizeShareImageUrl(share.image_url, {
        allowedPrefix,
        shareUserId: share.user_id,
      })
    : null;
  if (safeImageUrl) {
    return Response.redirect(safeImageUrl, 302);
  }

  const fonts = await getFonts();

  const gameTitle = share.game_title;
  const gameMeta = getGameMetaBySlug(gameTitle);
  const trackerName = gameMeta.trackerName;

  const element =
    share.share_type === "stats"
      ? renderStatsOg(share.share_data as unknown as StatsData, appUrl, trackerName, gameTitle ?? undefined)
      : renderDeckOg(share.share_data as unknown as DeckData, share.share_type, appUrl, trackerName, gameTitle ?? undefined);

  return new ImageResponse(element, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "NotoSansJP", data: fonts.regular, weight: 400 as const, style: "normal" as const },
      { name: "NotoSansJP", data: fonts.bold, weight: 700 as const, style: "normal" as const },
    ],
    headers: {
      "Cache-Control": "public, max-age=604800, s-maxage=604800, immutable",
    },
  });
}
