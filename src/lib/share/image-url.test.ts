import { describe, it, expect } from "vitest";
import {
  sanitizeShareImageUrl,
  normalizeSupabaseStoragePrefix,
} from "./image-url";

const PREFIX = "https://example.supabase.co/storage/v1/object/public/share-images/";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";

describe("sanitizeShareImageUrl", () => {
  it("returns null for null / undefined / empty input", () => {
    expect(sanitizeShareImageUrl(null, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
    expect(sanitizeShareImageUrl(undefined, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
    expect(sanitizeShareImageUrl("", { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
  });

  it("returns the URL when prefix + user_id match", () => {
    const ok = `${PREFIX}${USER_ID}/abc.png`;
    expect(sanitizeShareImageUrl(ok, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBe(ok);
  });

  it("rejects URL under a different user_id", () => {
    const wrong = `${PREFIX}${OTHER_USER_ID}/abc.png`;
    expect(sanitizeShareImageUrl(wrong, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
  });

  it("rejects external URL with different prefix", () => {
    expect(
      sanitizeShareImageUrl("https://malicious.example/track.png", {
        allowedPrefix: PREFIX,
        shareUserId: USER_ID,
      })
    ).toBeNull();
  });

  it("rejects protocol-relative", () => {
    expect(
      sanitizeShareImageUrl("//malicious.example/track.png", {
        allowedPrefix: PREFIX,
        shareUserId: USER_ID,
      })
    ).toBeNull();
  });

  it("rejects URL with query string", () => {
    const withQuery = `${PREFIX}${USER_ID}/abc.png?foo=bar`;
    expect(sanitizeShareImageUrl(withQuery, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
  });

  it("rejects URL with fragment", () => {
    const withFrag = `${PREFIX}${USER_ID}/abc.png#hash`;
    expect(sanitizeShareImageUrl(withFrag, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
  });

  it("rejects when only the prefix is provided without a path", () => {
    expect(sanitizeShareImageUrl(PREFIX, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
  });

  it("rejects when user_id segment has no trailing file", () => {
    const dirOnly = `${PREFIX}${USER_ID}/`;
    expect(sanitizeShareImageUrl(dirOnly, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
  });

  it("rejects when user_id segment is partial (prefix match but different folder)", () => {
    const partial = `${PREFIX}${USER_ID}extra/abc.png`;
    expect(sanitizeShareImageUrl(partial, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBeNull();
  });

  it("rejects when allowedPrefix or shareUserId is missing", () => {
    const ok = `${PREFIX}${USER_ID}/abc.png`;
    expect(sanitizeShareImageUrl(ok, { allowedPrefix: "", shareUserId: USER_ID })).toBeNull();
    expect(sanitizeShareImageUrl(ok, { allowedPrefix: PREFIX, shareUserId: "" })).toBeNull();
  });

  it("accepts nested paths under the user_id folder", () => {
    const nested = `${PREFIX}${USER_ID}/2026/05/abc.png`;
    expect(sanitizeShareImageUrl(nested, { allowedPrefix: PREFIX, shareUserId: USER_ID })).toBe(nested);
  });
});

describe("sanitizeShareImageUrl with allowedPrefixes (multiple candidates)", () => {
  const OTHER_PREFIX =
    "https://other.supabase.co/storage/v1/object/public/share-images/";

  it("accepts URL matching the first prefix", () => {
    const ok = `${PREFIX}${USER_ID}/abc.png`;
    expect(
      sanitizeShareImageUrl(ok, {
        allowedPrefixes: [PREFIX, OTHER_PREFIX],
        shareUserId: USER_ID,
      })
    ).toBe(ok);
  });

  it("accepts URL matching the second prefix when the first does not match", () => {
    const ok = `${OTHER_PREFIX}${USER_ID}/abc.png`;
    expect(
      sanitizeShareImageUrl(ok, {
        allowedPrefixes: [PREFIX, OTHER_PREFIX],
        shareUserId: USER_ID,
      })
    ).toBe(ok);
  });

  it("rejects when no prefix in the list matches", () => {
    const url = `${PREFIX}${USER_ID}/abc.png`;
    expect(
      sanitizeShareImageUrl(url, {
        allowedPrefixes: ["https://nope.example/x/", OTHER_PREFIX],
        shareUserId: USER_ID,
      })
    ).toBeNull();
  });

  it("ignores null / undefined / empty entries in allowedPrefixes", () => {
    const ok = `${PREFIX}${USER_ID}/abc.png`;
    expect(
      sanitizeShareImageUrl(ok, {
        allowedPrefixes: [null, undefined, "", PREFIX],
        shareUserId: USER_ID,
      })
    ).toBe(ok);
  });

  it("returns null when allowedPrefixes is an empty array", () => {
    const ok = `${PREFIX}${USER_ID}/abc.png`;
    expect(
      sanitizeShareImageUrl(ok, {
        allowedPrefixes: [],
        shareUserId: USER_ID,
      })
    ).toBeNull();
  });

  it("still rejects external URL even with multiple allowed prefixes", () => {
    expect(
      sanitizeShareImageUrl("https://malicious.example/track.png", {
        allowedPrefixes: [PREFIX, OTHER_PREFIX],
        shareUserId: USER_ID,
      })
    ).toBeNull();
  });
});

describe("normalizeSupabaseStoragePrefix", () => {
  it("appends share-images path for a clean Supabase URL", () => {
    expect(normalizeSupabaseStoragePrefix("https://example.supabase.co")).toBe(
      "https://example.supabase.co/storage/v1/object/public/share-images/"
    );
  });

  it("strips a single trailing slash", () => {
    expect(normalizeSupabaseStoragePrefix("https://example.supabase.co/")).toBe(
      "https://example.supabase.co/storage/v1/object/public/share-images/"
    );
  });

  it("strips multiple trailing slashes (no double-slash artifact)", () => {
    expect(normalizeSupabaseStoragePrefix("https://example.supabase.co///")).toBe(
      "https://example.supabase.co/storage/v1/object/public/share-images/"
    );
  });

  it("returns null for null / undefined / empty / non-string", () => {
    expect(normalizeSupabaseStoragePrefix(null)).toBeNull();
    expect(normalizeSupabaseStoragePrefix(undefined)).toBeNull();
    expect(normalizeSupabaseStoragePrefix("")).toBeNull();
  });
});

describe("trailing slash regression: env-derived prefix must still accept safe URLs", () => {
  // 回帰: 2026-05-27 dev preview で staging share の og:image が
  // /api/og fallback になっていた現象。NEXT_PUBLIC_SUPABASE_URL に
  // trailing slash があると `${url}/storage/...` で double slash になり
  // sanitizer の prefix 一致が失敗していた。
  it("accepts safe URL when NEXT_PUBLIC_SUPABASE_URL has a trailing slash", () => {
    const envWithTrailingSlash = "https://example.supabase.co/";
    const allowedPrefix = normalizeSupabaseStoragePrefix(envWithTrailingSlash);
    expect(allowedPrefix).toBe(PREFIX);

    const safeUrl = `${PREFIX}${USER_ID}/abc.png`;
    expect(
      sanitizeShareImageUrl(safeUrl, {
        allowedPrefix: allowedPrefix!,
        shareUserId: USER_ID,
      })
    ).toBe(safeUrl);
  });

  it("accepts safe URL via allowedPrefixes when env is normalized alongside a DB prefix", () => {
    const dbPrefix = PREFIX;
    const envPrefix = normalizeSupabaseStoragePrefix("https://example.supabase.co///");
    const safeUrl = `${dbPrefix}${USER_ID}/abc.png`;
    expect(
      sanitizeShareImageUrl(safeUrl, {
        allowedPrefixes: [dbPrefix, envPrefix],
        shareUserId: USER_ID,
      })
    ).toBe(safeUrl);
  });
});
