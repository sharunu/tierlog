"use client";

import { useEffect } from "react";
import { HomeLink } from "@/components/layout/HomeLink";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="space-y-2">
          <h1 className="text-[28px] font-medium">エラーが発生しました</h1>
          <p className="text-sm text-muted-foreground">
            一時的な問題が発生しました。しばらく経ってから再度お試しください。
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => reset()}
            className="rounded-[10px] px-5 py-3 text-sm font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            再読み込み
          </button>
          <HomeLink
            className="rounded-[10px] px-5 py-3 text-sm font-medium bg-surface-1 hover:bg-surface-2 transition-colors"
            style={{ border: "0.5px solid var(--border)" }}
          />
        </div>
      </div>
    </div>
  );
}
