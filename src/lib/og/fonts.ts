/**
 * Plan B B-2: OG ルートで使うフォントを ASSETS binding (public/fonts/) から取得する。
 *
 * 設計:
 * - Cloudflare Workers の ASSETS binding 経由で public/fonts/NotoSansJP-{Regular,Bold}.ttf を fetch。
 * - 取得結果は module-scope cache (FONT_CACHE) に保持し、同 isolate 内の以降のリクエストで再フェッチを避ける。
 * - 取得失敗時 (ASSETS binding 不在 / fetch エラー) は空配列を返してフォントなしで render させる
 *   (SNS プレビューが完全に壊れるよりは「フォントが OS デフォルトに崩れた画像」を出す方が好ましい)。
 *
 * 旧実装は毎リクエストで https://fonts.googleapis.com に fetch して TTF を取得していたため、
 * Google Fonts 障害時に OG が 500 を返す SPOF だった。これを ASSETS binding に置き換え、
 * 外部依存を排除する。
 */

// Cloudflare Workers の ASSETS binding は最小限 fetch メソッドを持つ Fetcher 互換 interface。
// @cloudflare/workers-types を導入しない構成のため、必要な surface だけを構造的サブタイピングで定義。
export type AssetsFetcher = {
  fetch: (input: URL | Request | string, init?: RequestInit) => Promise<Response>;
};

type FontWeight = 400 | 700;
type FontStyle = "normal";

export type OgFontEntry = {
  name: "NotoSansJP";
  data: ArrayBuffer;
  weight: FontWeight;
  style: FontStyle;
};

let FONT_CACHE: OgFontEntry[] | null = null;

// ASSETS binding の fetch URL に使う placeholder origin。
// Cloudflare ASSETS binding は `fetch(new URL("/fonts/...", "http://localhost"))` の形で
// path だけが意味を持つ (host は無視される)。
const ASSETS_ORIGIN = "http://placeholder.invalid";

export async function loadOgFonts(
  assetsBinding: AssetsFetcher | undefined
): Promise<OgFontEntry[]> {
  if (FONT_CACHE) return FONT_CACHE;
  if (!assetsBinding) return [];
  try {
    const [regular, bold] = await Promise.all([
      fetchAssetArrayBuffer(assetsBinding, "/fonts/NotoSansJP-Regular.ttf"),
      fetchAssetArrayBuffer(assetsBinding, "/fonts/NotoSansJP-Bold.ttf"),
    ]);
    if (!regular || !bold) return [];
    FONT_CACHE = [
      { name: "NotoSansJP", data: regular, weight: 400, style: "normal" },
      { name: "NotoSansJP", data: bold, weight: 700, style: "normal" },
    ];
    return FONT_CACHE;
  } catch (e) {
    console.error("loadOgFonts failed:", e);
    return [];
  }
}

async function fetchAssetArrayBuffer(
  assets: AssetsFetcher,
  path: string
): Promise<ArrayBuffer | null> {
  const res = await assets.fetch(new URL(path, ASSETS_ORIGIN));
  if (!res.ok) {
    console.error(
      `OG font asset fetch failed: path=${path} status=${res.status}`
    );
    return null;
  }
  return await res.arrayBuffer();
}

/**
 * テスト用の cache reset。本番コードからは呼ばない。
 */
export function __resetOgFontCacheForTest(): void {
  FONT_CACHE = null;
}
