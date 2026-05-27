// shares.image_url の display-time sanitizer。
//
// 役割: read-time 防御。trigger 適用前に既存行へ混入した外部 URL や、他 user_id 配下の
// Storage URL も表示時に止める (DB trigger と併せた defense-in-depth、Plan A RD-2)。
//
// 許可条件 (すべて満たすこと):
//   1. imageUrl が null → そのまま null (画像なし share、OG fallback 経路)
//   2. imageUrl が allowedPrefixes のいずれかで始まる
//      (DB の app_settings.storage_public_url_prefix を一次正、
//       env 由来 fallback を二次として両方を試す。詳細は share page / og route の
//       resolveAllowedPrefixes を参照)
//   3. prefix 除去後の残り pathname が `${opts.shareUserId}/...` の形 (1 階層目が
//      shareUserId と完全一致)
//   4. クエリ文字列 (?) / フラグメント (#) を含まない (Storage public URL に query は付かない)
//
// 違反は null を返し、呼び出し側は fallback (`/api/og/${id}` の next/og 自己生成) を使う。

export type SanitizeShareImageUrlOptions = {
  shareUserId: string;
  // 単数 allowedPrefix と複数 allowedPrefixes のどちらでも渡せる。両方指定時は
  // allowedPrefixes を優先 (より広い指定を選ぶことで safe を漏れにくくする)。
  allowedPrefix?: string;
  allowedPrefixes?: ReadonlyArray<string | null | undefined>;
};

function checkAgainstPrefix(
  imageUrl: string,
  allowedPrefix: string,
  shareUserId: string
): boolean {
  if (allowedPrefix.length === 0) return false;
  if (!imageUrl.startsWith(allowedPrefix)) return false;

  const rest = imageUrl.slice(allowedPrefix.length);
  if (rest.length === 0) return false;

  const firstSlash = rest.indexOf("/");
  if (firstSlash <= 0) return false;
  const firstSegment = rest.slice(0, firstSlash);
  if (firstSegment !== shareUserId) return false;

  const remainder = rest.slice(firstSlash + 1);
  if (remainder.length === 0) return false;

  return true;
}

export function sanitizeShareImageUrl(
  imageUrl: string | null | undefined,
  opts: SanitizeShareImageUrlOptions
): string | null {
  if (imageUrl == null) return null;
  if (typeof imageUrl !== "string") return null;
  if (imageUrl.length === 0) return null;

  const { shareUserId } = opts;
  if (!shareUserId) return null;

  // query / fragment 拒否 (Storage public URL に query/fragment は付かない)
  if (imageUrl.includes("?") || imageUrl.includes("#")) return null;

  const rawPrefixes: ReadonlyArray<string | null | undefined> =
    opts.allowedPrefixes ?? (opts.allowedPrefix !== undefined ? [opts.allowedPrefix] : []);
  const candidatePrefixes = rawPrefixes.filter(
    (p): p is string => typeof p === "string" && p.length > 0
  );
  if (candidatePrefixes.length === 0) return null;

  for (const allowedPrefix of candidatePrefixes) {
    if (checkAgainstPrefix(imageUrl, allowedPrefix, shareUserId)) {
      return imageUrl;
    }
  }
  return null;
}

// `NEXT_PUBLIC_SUPABASE_URL` から Storage の share-images public URL prefix を組み立てる。
// 例: "https://example.supabase.co" → "https://example.supabase.co/storage/v1/object/public/share-images/"
//
// 末尾 slash の数に関わらず正規化し、`${url}/storage/...` で double slash になる事故を防ぐ。
// 戻り値は常に末尾 slash 付きの完成形、または null (入力が空/非文字列の場合)。
export function normalizeSupabaseStoragePrefix(
  supabaseUrl: string | null | undefined
): string | null {
  if (supabaseUrl == null) return null;
  if (typeof supabaseUrl !== "string") return null;
  const trimmed = supabaseUrl.replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  return `${trimmed}/storage/v1/object/public/share-images/`;
}
