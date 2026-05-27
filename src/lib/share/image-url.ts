// shares.image_url の display-time sanitizer。
//
// 役割: read-time 防御。trigger 適用前に既存行へ混入した外部 URL や、他 user_id 配下の
// Storage URL も表示時に止める (DB trigger と併せた defense-in-depth、Plan A RD-2)。
//
// 許可条件 (すべて満たすこと):
//   1. imageUrl が null → そのまま null (画像なし share、OG fallback 経路)
//   2. imageUrl が opts.allowedPrefix で始まる
//   3. prefix 除去後の残り pathname が `${opts.shareUserId}/...` の形 (1 階層目が
//      shareUserId と完全一致)
//   4. クエリ文字列 (?) / フラグメント (#) を含まない (Storage public URL に query は付かない)
//
// 違反は null を返し、呼び出し側は fallback (`/api/og/${id}` の next/og 自己生成) を使う。

export type SanitizeShareImageUrlOptions = {
  allowedPrefix: string;
  shareUserId: string;
};

export function sanitizeShareImageUrl(
  imageUrl: string | null | undefined,
  opts: SanitizeShareImageUrlOptions
): string | null {
  if (imageUrl == null) return null;
  if (typeof imageUrl !== "string") return null;
  if (imageUrl.length === 0) return null;

  const { allowedPrefix, shareUserId } = opts;
  if (!allowedPrefix || !shareUserId) return null;

  // query / fragment 拒否
  if (imageUrl.includes("?") || imageUrl.includes("#")) return null;

  // prefix 一致
  if (!imageUrl.startsWith(allowedPrefix)) return null;

  // prefix 除去後の pathname を取得
  const rest = imageUrl.slice(allowedPrefix.length);
  if (rest.length === 0) return null;

  // 1 階層目が shareUserId と完全一致
  const firstSlash = rest.indexOf("/");
  if (firstSlash <= 0) return null;
  const firstSegment = rest.slice(0, firstSlash);
  if (firstSegment !== shareUserId) return null;

  // 2 階層目以降が空でないこと
  const remainder = rest.slice(firstSlash + 1);
  if (remainder.length === 0) return null;

  return imageUrl;
}
