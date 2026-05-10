"use client";

import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { getWinRateColor } from "@/lib/stats-utils";
import { colorForArchetype } from "@/lib/deck-archetype-colors";
import {
  displayDeckName,
  type OpponentDeckNameMap,
} from "@/lib/actions/opponent-deck-display";
import { formatWLTJa } from "@/lib/battle/result-format";

interface DonutItem {
  name: string;
  total: number;
  winRate: number | null;
}

interface Props {
  items: DonutItem[];
  otherBreakdown?: DonutItem[];
  overallWinRate: number | null;
  overallWins: number;
  overallLosses: number;
  overallDraws: number;
  overallTotal: number;
  opponentDeckNameMap?: OpponentDeckNameMap;
  game: string;
}

const RADIAN = Math.PI / 180;

const renderLabel = (props: any) => {
  const { cx, cy, midAngle, innerRadius, outerRadius, pct } = props;
  const radius = (innerRadius + outerRadius) / 2;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fill="#fff"
      fontSize={11}
      fontWeight="bold"
      dominantBaseline="central"
    >
      {pct}%
    </text>
  );
};

export function EncounterDonutChart({ items, otherBreakdown, overallWinRate, overallWins, overallLosses, overallDraws, overallTotal, opponentDeckNameMap, game }: Props) {
  const display = (name: string) =>
    name === "その他" ? name : displayDeckName(name, opponentDeckNameMap);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [animationDone, setAnimationDone] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartCenter, setChartCenter] = useState<{ cx: number; cy: number } | null>(null);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const activeIndexRef = useRef(activeIndex);

  const innerRadius = 55;
  const outerRadius = 80;

  useEffect(() => { activeIndexRef.current = activeIndex; }, [activeIndex]);

  useEffect(() => { setOtherExpanded(false); }, [items]);

  const data = useMemo(() =>
    items
      .map((item) => ({
        name: item.name,
        value: item.total,
        pct: overallTotal > 0 ? Math.round((item.total / overallTotal) * 100) : 0,
      }))
      .sort((a, b) => {
        if (a.name === "その他") return 1;
        if (b.name === "その他") return -1;
        return b.value - a.value;
      }),
  [items, overallTotal]);

  const sortedBreakdown = useMemo(() => {
    if (!otherBreakdown || otherBreakdown.length === 0) return [];
    return [...otherBreakdown]
      .sort((a, b) => b.total - a.total)
      .map(item => ({
        name: item.name,
        total: item.total,
        pct: overallTotal > 0 ? Math.round((item.total / overallTotal) * 100) : 0,
        winRate: item.winRate,
      }));
  }, [otherBreakdown, overallTotal]);

  const winRateColor = getWinRateColor(overallWinRate);

  useEffect(() => {
    const updateCenter = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setChartCenter({ cx: rect.width / 2, cy: rect.height / 2 });
      }
    };
    updateCenter();
    window.addEventListener("resize", updateCenter);
    return () => window.removeEventListener("resize", updateCenter);
  }, []);

  const getArcIndexFromPoint = useCallback((clientX: number, clientY: number): number => {
    if (!containerRef.current || !chartCenter) return -1;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = (clientX - rect.left) - chartCenter.cx;
    const dy = (clientY - rect.top) - chartCenter.cy;
    const r = Math.sqrt(dx * dx + dy * dy);

    if (r < innerRadius || r > outerRadius + 10) return -1;

    let angle = Math.atan2(-dy, dx) / RADIAN;
    angle = ((90 - angle) % 360 + 360) % 360;

    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return -1;

    let cumulative = 0;
    for (let i = 0; i < data.length; i++) {
      cumulative += (data[i].value / total) * 360;
      if (angle <= cumulative) return i;
    }
    return data.length - 1;
  }, [chartCenter, data, innerRadius, outerRadius]);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    const idx = getArcIndexFromPoint(touch.clientX, touch.clientY);
    if (idx >= 0) {
      e.preventDefault();
      setActiveIndex(idx);
    }
  }, [getArcIndexFromPoint]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    const idx = getArcIndexFromPoint(touch.clientX, touch.clientY);
    if (idx >= 0) {
      e.preventDefault();
      if (idx !== activeIndexRef.current) {
        setActiveIndex(idx);
      }
    } else if (activeIndexRef.current >= 0) {
      setActiveIndex(-1);
    }
  }, [getArcIndexFromPoint]);

  const handleTouchEnd = useCallback(() => {
    setActiveIndex(-1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("touchstart", handleTouchStart, { passive: false });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  const getOverlayPosition = useCallback(() => {
    if (activeIndex < 0 || !chartCenter) return null;

    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return null;

    let cumulativeAngle = 90;
    for (let i = 0; i < activeIndex; i++) {
      cumulativeAngle -= (data[i].value / total) * 360;
    }
    const segmentAngle = (data[activeIndex].value / total) * 360;
    const midAngle = cumulativeAngle - segmentAngle / 2;

    const labelRadius = outerRadius + 20;
    const x = chartCenter.cx + labelRadius * Math.cos(-midAngle * RADIAN);
    const y = chartCenter.cy + labelRadius * Math.sin(-midAngle * RADIAN);

    return { x, y, midAngle };
  }, [activeIndex, chartCenter, data, outerRadius]);

  const overlayPos = getOverlayPosition();

  const getColor = (name: string) => colorForArchetype(name);

  return (
    <div className="space-y-3">
      <div
        ref={containerRef}
        className="relative"
        style={{
          height: 180,
          touchAction: "none",
          WebkitTapHighlightColor: "transparent",
          userSelect: "none",
        }}
        role="img"
        aria-label={`対面デッキ分布: 上位${data.length}デッキの構成比、総合勝率${overallWinRate === null ? "--" : `${overallWinRate}%`}、${overallTotal}件`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              stroke="none"
              startAngle={90}
              endAngle={-270}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(-1)}
              onAnimationEnd={() => setAnimationDone(true)}
              isAnimationActive={!animationDone}
              label={renderLabel}
              labelLine={false}
            >
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={getColor(entry.name)}
                  opacity={activeIndex >= 0 && activeIndex !== i ? 0.35 : 1}
                  style={{ transition: "opacity 150ms" }}
                />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="flex items-baseline gap-1">
            <span className="text-sm text-muted-foreground">勝率</span>
            <span className="text-2xl font-bold" style={{ color: winRateColor }}>{overallWinRate === null ? "--" : overallWinRate}%</span>
          </div>
          <span className="text-xs text-muted-foreground">{formatWLTJa(overallWins, overallLosses, overallDraws, game)} / {overallTotal}件</span>
        </div>

        {activeIndex >= 0 && overlayPos && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: overlayPos.x,
              top: overlayPos.y,
              transform: "translate(-50%, -50%)",
              zIndex: 10,
            }}
          >
            <span className="text-xs font-medium whitespace-nowrap px-1.5 py-0.5 rounded bg-black/70 text-white">
              {display(data[activeIndex].name)}
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center">
        {data.map((d, i) => {
          const color = getColor(d.name);
          const isOther = d.name === "その他";
          const hasBreakdown = isOther && otherBreakdown && otherBreakdown.length > 0;
          return (
            <div
              key={d.name}
              className={`flex items-center gap-1.5 text-xs cursor-pointer rounded px-1 py-0.5 transition-colors ${
                activeIndex === i ? "bg-foreground/5" : ""
              }`}
              style={{
                outline: activeIndex === i ? `2px solid ${color}` : "none",
                outlineOffset: 1,
              }}
              onClick={() => {
                if (hasBreakdown) {
                  setOtherExpanded(prev => !prev);
                  setActiveIndex(-1);
                } else {
                  setActiveIndex(activeIndex === i ? -1 : i);
                }
              }}
            >
              <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: color }} />
              <span className="text-muted-foreground">
                {display(d.name)}
                {hasBreakdown && <span className="ml-0.5 text-[10px]">{otherExpanded ? "▲" : "▼"}</span>}
              </span>
              <span className="font-medium">{d.pct}%</span>
            </div>
          );
        })}
      </div>

      {otherExpanded && sortedBreakdown.length > 0 && (
        <div className="rounded-lg border border-border bg-card/50 px-3 py-2">
          <div className="text-[11px] text-muted-foreground mb-1.5">{"「その他」内訳"}</div>
          <div className="space-y-1">
            {sortedBreakdown.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate mr-2">{display(item.name)}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-medium">{item.pct}%</span>
                  <span className="text-muted-foreground">({item.total}件)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
