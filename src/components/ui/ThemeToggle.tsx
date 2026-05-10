"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useTheme } from "@/components/providers/ThemeProvider";
import type { Theme } from "@/lib/theme";

const ITEMS = [
  {
    value: "light" as const,
    label: (
      <span className="flex items-center justify-center gap-1.5">
        <Sun size={14} aria-hidden />
        ライト
      </span>
    ),
  },
  {
    value: "dark" as const,
    label: (
      <span className="flex items-center justify-center gap-1.5">
        <Moon size={14} aria-hidden />
        ダーク
      </span>
    ),
  },
  {
    value: "system" as const,
    label: (
      <span className="flex items-center justify-center gap-1.5">
        <Monitor size={14} aria-hidden />
        システム
      </span>
    ),
  },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <SegmentedControl<Theme>
      items={ITEMS}
      value={theme}
      onChange={setTheme}
      size="sm"
      fullWidth
      ariaLabel="テーマ切替"
      role="radiogroup"
    />
  );
}
