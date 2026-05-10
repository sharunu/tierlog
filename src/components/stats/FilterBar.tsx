"use client";

import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

export function FilterBar({ children, className }: Props) {
  return (
    <div className={`flex flex-col gap-3${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
