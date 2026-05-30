import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BanGuard } from "@/components/providers/BanGuard";
import { AuthGuard } from "@/components/providers/AuthGuard";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import "./globals.css";

const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('tierlog-theme');var r;if(t==='light'||t==='dark'){r=t;}else if(t==='system'){r=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}else{r='dark';}document.documentElement.setAttribute('data-theme',r);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_NAME = "Tierlog";
const SITE_DESCRIPTION = "各ゲームの対戦記録・環境分析ツール";

// Plan B (Codex 第 6 回) / dev preview 実測:
// Cloudflare 経路で X-Robots-Tag の comma-separated 値が `noindex` のみに切り詰められる事象を観測。
// `noindex` は X-Robots-Tag header 経路で確実に伝送できることは確認済なので、
// `nofollow` `noarchive` は `<meta name="robots">` 経由で SSR HTML に出して補完する。
// NEXT_PUBLIC_SUPABASE_ENV は build 時 inline されるため、staging build (dev preview)
// 限定で root レベルに `noindex, nofollow, noarchive` の meta を埋め込む。
const IS_STAGING_BUILD = process.env.NEXT_PUBLIC_SUPABASE_ENV === "staging";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  // 本番 build では robots を未指定 (default index、meta 不在) にする。
  // Codex 第 6 回期待値「本番 / に header / meta なし」を厳密に満たすため。
  robots: IS_STAGING_BUILD
    ? { index: false, follow: false, noarchive: true }
    : undefined,
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    description: SITE_DESCRIPTION,
  },
  // Plan E / E-6: build marker。NEXT_PUBLIC_BUILD_SHA は prepare-cloudflare-env.sh が
  // build 時に export する git SHA(12 桁、非 secret)。build 時 inline されるため
  // curl で SSR HTML を取得すれば稼働ビルドの SHA が判別できる (client hook 不要 = build 安全)。
  // 未設定 build (script を source しない場合) は "unknown"。Plan B の OG/robots meta とは別 meta。
  other: {
    "x-tierlog-build": process.env.NEXT_PUBLIC_BUILD_SHA ?? "unknown",
  },
};

// 注: themeColor は OS chrome (status bar) のテーマ色を制御する metadata。
// dark 値は --background と一致させ、light 値は light --background と一致させる。
// SSR metadata で CSS 変数を読めないため hex 直書き必須 (本 plan の例外領域)。
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cfBeaconToken = process.env.NEXT_PUBLIC_CF_BEACON_TOKEN;

  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider>
          <ServiceWorkerRegistration />
          <InstallPrompt />
          <ErrorBoundary><AuthGuard><BanGuard>{children}</BanGuard></AuthGuard></ErrorBoundary>
        </ThemeProvider>
        {cfBeaconToken && (
          <Script
            strategy="afterInteractive"
            src="https://static.cloudflareinsights.com/beacon.min.js"
            data-cf-beacon={JSON.stringify({ token: cfBeaconToken })}
          />
        )}
      </body>
    </html>
  );
}
