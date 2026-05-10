"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  bottomNav?: boolean;
  maxWidth?: "default" | "wide";
  className?: string;
};

export function PageShell({
  children,
  bottomNav = true,
  maxWidth = "default",
  className,
}: Props) {
  const padBottom = bottomNav ? "pb-20" : "";
  const widthClass =
    maxWidth === "wide" ? "max-w-lg lg:max-w-3xl" : "max-w-lg";
  const extra = className ? ` ${className}` : "";
  return (
    <div className={`min-h-screen ${padBottom} px-4 pt-6 ${widthClass} mx-auto space-y-4${extra}`}>
      {children}
    </div>
  );
}
