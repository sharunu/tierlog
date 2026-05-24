"use client";

import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { assignChartColors } from "@/lib/chart-colors";

export type TrendDataPoint = {
  periodStart: string;
  deckName: string;
  battleCount: number;
  sharePct: number;
};

function CustomTrendTooltip({
  active,
  payload,
  label,
  highlightedDeck,
  deckColorMap,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value?: number; payload?: Record<string, number | string | undefined> }>;
  label?: string;
  highlightedDeck: string | null;
  deckColorMap: Map<string, string>;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const items = highlightedDeck
    ? payload.filter((p) => p.dataKey === highlightedDeck)
    : payload;

  if (items.length === 0) return null;

  const borderColor =
    highlightedDeck && items.length === 1
      ? deckColorMap.get(highlightedDeck) ?? "var(--border-subtle)"
      : "var(--border-subtle)";

  return (
    <div
      className="bg-surface-2 rounded-lg shadow-lg px-2.5 py-2 text-xs text-foreground min-w-[100px]"
      style={{ border: `0.5px solid ${borderColor}` }}
    >
      {items.map((entry) => {
        const color = deckColorMap.get(entry.dataKey) ?? "var(--muted-foreground)";
        const battleCount = entry.payload?.[`__bc_${entry.dataKey}`];
        return (
          <div key={entry.dataKey} className={items.length > 1 ? "mb-1" : ""}>
            <div className="flex items-center gap-1.5">
              <div
                className="w-[7px] h-[7px] rounded-sm shrink-0"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium">{entry.dataKey}</span>
            </div>
            <div className="text-muted-foreground ml-3 mt-0.5">
              {label} &nbsp;{entry.value}%
              {battleCount != null && (
                <span className="ml-1">({battleCount}件)</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TrendChart({ data }: { data: TrendDataPoint[] }) {
  const [highlightedDeck, setHighlightedDeck] = useState<string | null>(null);

  if (data.length === 0) {
    return (
      <p className="text-center text-muted-foreground py-8 text-sm">
        データがありません
      </p>
    );
  }

  const deckTotals = new Map<string, number>();
  for (const d of data) {
    deckTotals.set(d.deckName, (deckTotals.get(d.deckName) ?? 0) + d.battleCount);
  }
  const topDecks = Array.from(deckTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name]) => name);

  const deckColorMap = assignChartColors(topDecks);

  const dateMap = new Map<string, Record<string, number>>();
  for (const d of data) {
    if (!topDecks.includes(d.deckName)) continue;
    if (!dateMap.has(d.periodStart)) {
      dateMap.set(d.periodStart, {});
    }
    const rec = dateMap.get(d.periodStart)!;
    rec[d.deckName] = d.sharePct;
    rec[`__bc_${d.deckName}`] = d.battleCount;
  }

  const chartData = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, decks]) => ({
      date: date.slice(5),
      ...decks,
    }));

  const latestPeriod = chartData[chartData.length - 1];

  const handleLegendClick = (deck: string) => {
    setHighlightedDeck((prev) => (prev === deck ? null : deck));
  };

  const handleLineClick = (deck: string) => {
    setHighlightedDeck((prev) => (prev === deck ? null : deck));
  };

  return (
    <div onClick={() => setHighlightedDeck(null)}>
      <div className="text-[15px] font-medium text-foreground mb-2">
        対面デッキ使用率
      </div>

      <div
        className="bg-surface-2 rounded-[10px] border border-border-subtle"
        style={{ padding: "16px 8px 12px" }}
        role="img"
        aria-label={`対面デッキ使用率推移: 上位${topDecks.length}デッキの折れ線`}
      >
        <div style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="var(--border-subtle)" strokeWidth={0.5} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickLine={false}
              />
              <YAxis
                width={40}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickLine={false}
                unit="%"
              />
              <Tooltip
                trigger="click"
                content={
                  <CustomTrendTooltip
                    highlightedDeck={highlightedDeck}
                    deckColorMap={deckColorMap}
                  />
                }
              />
              {topDecks.map((deck) => {
                const color = deckColorMap.get(deck) ?? "var(--muted-foreground)";
                const isHighlighted = highlightedDeck === deck;
                const hasHighlight = highlightedDeck !== null;

                const sw = hasHighlight
                  ? isHighlighted ? 3 : 1.5
                  : 2;
                const op = hasHighlight
                  ? isHighlighted ? 1 : 0.4
                  : 1;
                const dotConfig = hasHighlight
                  ? isHighlighted ? { r: 4 } : false
                  : { r: 3 };

                return (
                  <Line
                    key={deck}
                    type="monotone"
                    dataKey={deck}
                    stroke={color}
                    strokeWidth={sw}
                    opacity={op}
                    dot={dotConfig}
                    activeDot={{
                      r: 5,
                      // recharts activeDot.onClick の signature は
                      // RechartsMouseEventHandler<DotProps, SVGCircleElement> で、
                      // React.MouseEvent 単独型と互換にできないため per-line で any を許可。
                      // event arg は stopPropagation() を呼べるオブジェクトとしてのみ使う。
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      onClick: (e: any) => {
                        e?.stopPropagation?.();
                        handleLineClick(deck);
                      },
                    }}
                    connectNulls
                    style={{ transition: "opacity 0.2s ease" }}
                    onClick={() => handleLineClick(deck)}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] mt-2.5" style={{ lineHeight: 1.8 }}>
        {topDecks.map((deck) => {
          const color = deckColorMap.get(deck) ?? "var(--muted-foreground)";
          const isHighlighted = highlightedDeck === deck;
          const hasHighlight = highlightedDeck !== null;
          // chartData の要素型は `{ date: string }` のみとして推論され、spread した
          // `...decks: Record<string, number>` が継承されないため、明示的に narrow する。
          const latestPct = (latestPeriod as Record<string, number | string | undefined> | undefined)?.[deck];

          return (
            <div
              key={deck}
              onClick={(e) => {
                e.stopPropagation();
                handleLegendClick(deck);
              }}
              className={`flex items-center gap-1 cursor-pointer transition-colors ${
                hasHighlight
                  ? isHighlighted ? "text-foreground font-medium" : "text-muted-foreground"
                  : "text-muted-foreground"
              }`}
            >
              <div
                className="w-[7px] h-[7px] rounded-sm shrink-0 transition-opacity"
                style={{
                  backgroundColor: color,
                  opacity: hasHighlight && !isHighlighted ? 0.4 : 1,
                }}
              />
              <span>{deck}</span>
              {latestPct != null && (
                <span className="font-medium">{latestPct}%</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
