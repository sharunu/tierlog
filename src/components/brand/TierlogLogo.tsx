import { useId } from "react";

type Props = {
  className?: string;
  // SVG <title> の内容（アクセシブルネーム）。デフォルト "Tierlog"
  title?: string;
};

// Tierlog 横長ロゴ（インライン SVG / A3 v2 デザイン）。元素材: public/brand/tierlog-logo-horizontal.svg
// カードファン型マークは v2 のグラデーション / 影を忠実再現する。
// wordmark は currentColor で親の text 色に追従する（ダーク=明色 / ライト=濃色）。
// <svg> には width/height 属性を付けず viewBox のみ。サイズは呼び出し側 className（h-* + w-auto）で指定する。
// viewBox 0 0 501 200 は実描画範囲（マーク左端〜Geist 900 wordmark 右端）にタイトに合わせている。
// 右側に余白を残すと mx-auto 中央寄せ時にロゴが左へ寄って見えるため。
export function TierlogLogo({ className, title = "Tierlog" }: Props) {
  // useId() は ":" 等の記号を含み得るため、url(#...) 参照で安全なよう英数字のみへ正規化する。
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (key: string) => `${uid}-${key}`;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 501 200"
      role="img"
      aria-labelledby={id("title")}
      preserveAspectRatio="xMidYMid meet"
      className={className}
    >
      <title id={id("title")}>{title}</title>
      <defs>
        <linearGradient id={id("teal")} x1="76" y1="126" x2="252" y2="372" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3fe6d2" />
          <stop offset="1" stopColor="#0c7fa5" />
        </linearGradient>
        <linearGradient id={id("blue")} x1="126" y1="98" x2="300" y2="354" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2f7cff" />
          <stop offset="1" stopColor="#143aa3" />
        </linearGradient>
        <linearGradient id={id("violet")} x1="228" y1="112" x2="382" y2="360" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7a6cff" />
          <stop offset="1" stopColor="#3a2a90" />
        </linearGradient>
        <linearGradient id={id("front")} x1="180" y1="86" x2="350" y2="364" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#102958" />
          <stop offset="0.56" stopColor="#0b1b40" />
          <stop offset="1" stopColor="#06112d" />
        </linearGradient>
        <linearGradient id={id("lines")} x1="214" y1="268" x2="308" y2="330" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3fe6d2" />
          <stop offset="0.5" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#6d5dfc" />
        </linearGradient>
        <filter
          id={id("shadow")}
          x="-20%"
          y="-20%"
          width="140%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#020617" floodOpacity="0.15" />
        </filter>
      </defs>
      <g transform="translate(5 11) scale(0.36)" filter={`url(#${id("shadow")})`}>
        <rect
          x="90"
          y="139"
          width="156"
          height="238"
          rx="25"
          fill={`url(#${id("teal")})`}
          stroke="#fbfdff"
          strokeWidth="9"
          transform="rotate(-15 168 258)"
        />
        <rect
          x="135"
          y="112"
          width="158"
          height="247"
          rx="25"
          fill={`url(#${id("blue")})`}
          stroke="#fbfdff"
          strokeWidth="9"
          transform="rotate(-7 214 236)"
        />
        <rect
          x="223"
          y="122"
          width="158"
          height="247"
          rx="25"
          fill={`url(#${id("violet")})`}
          stroke="#fbfdff"
          strokeWidth="9"
          transform="rotate(9 302 246)"
        />
        <g transform="rotate(4 262 228)">
          <rect
            x="171"
            y="88"
            width="184"
            height="274"
            rx="27"
            fill={`url(#${id("front")})`}
            stroke="#fbfdff"
            strokeWidth="9"
          />
          <path fill="#ffffff" d="M214 187l25 23 23-51 24 51 26-23-11 71h-76l-11-71z" />
          <rect x="228" y="269" width="70" height="10" rx="5" fill="#f8fbff" opacity="0.96" />
          <rect x="215" y="299" width="96" height="11" rx="5.5" fill={`url(#${id("lines")})`} />
          <rect x="224" y="329" width="78" height="11" rx="5.5" fill={`url(#${id("lines")})`} opacity="0.9" />
          <rect x="236" y="359" width="55" height="11" rx="5.5" fill={`url(#${id("lines")})`} opacity="0.78" />
          <path fill="#ffffff" opacity="0.06" d="M180 99h166v58L180 251V99z" />
        </g>
      </g>
      <text
        x="170"
        y="127"
        fill="currentColor"
        style={{ fontFamily: "var(--font-geist-sans), Inter, Arial, Helvetica, sans-serif" }}
        fontSize="88"
        fontWeight="900"
        letterSpacing="0"
      >
        Tierlog
      </text>
    </svg>
  );
}
