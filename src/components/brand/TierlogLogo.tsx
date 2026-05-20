import { useId } from "react";

type Props = {
  className?: string;
  // SVG <title> の内容（アクセシブルネーム）。デフォルト "Tierlog"
  title?: string;
};

// Tierlog 横長ロゴ（インライン SVG）。元素材: public/brand/tierlog-logo-horizontal.svg
// wordmark は currentColor で親の text 色に追従し、mark 3 段は固定色を維持する。
// <svg> には width/height 属性を付けず viewBox のみ。サイズは呼び出し側 className（h-* + w-auto）で指定する。
export function TierlogLogo({ className, title = "Tierlog" }: Props) {
  const titleId = useId();

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 760 200"
      role="img"
      aria-labelledby={titleId}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <title id={titleId}>{title}</title>
      <g
        transform="translate(24 18) scale(0.16)"
        stroke="#ffffff"
        strokeWidth="44"
        strokeLinejoin="round"
      >
        <path
          fill="#6366f1"
          d="M536 532 L806 667 Q834 680 806 693 L536 828 Q512 840 488 828 L218 693 Q190 680 218 667 L488 532 Q512 520 536 532 Z"
        />
        <path
          fill="#0f172a"
          d="M536 352 L806 487 Q834 500 806 513 L536 648 Q512 660 488 648 L218 513 Q190 500 218 487 L488 352 Q512 340 536 352 Z"
        />
        <path
          fill="#6366f1"
          d="M536 172 L806 307 Q834 320 806 333 L536 468 Q512 480 488 468 L218 333 Q190 320 218 307 L488 172 Q512 160 536 172 Z"
        />
      </g>
      <text
        x="210"
        y="122"
        fill="currentColor"
        style={{ fontFamily: "var(--font-geist-sans), Inter, Arial, sans-serif" }}
        fontSize="82"
        fontWeight="800"
        letterSpacing="0"
      >
        Tierlog
      </text>
    </svg>
  );
}
