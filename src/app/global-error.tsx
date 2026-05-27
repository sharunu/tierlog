"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
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
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f172a",
          color: "#f8fafc",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 500,
              margin: "0 0 8px 0",
            }}
          >
            一時的なエラーが発生しました
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "#94a3b8",
              margin: "0 0 24px 0",
              lineHeight: 1.6,
            }}
          >
            ページを再読み込みしてもエラーが続く場合は、しばらく経ってから再度お試しください。
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "12px 20px",
                borderRadius: 10,
                background: "#6366f1",
                color: "#f8fafc",
                fontSize: 14,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
              }}
            >
              再読み込み
            </button>
            <Link
              href="/"
              style={{
                padding: "12px 20px",
                borderRadius: 10,
                background: "transparent",
                color: "#f8fafc",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                border: "1px solid #334155",
              }}
            >
              トップに戻る
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
