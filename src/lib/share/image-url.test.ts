import { describe, it, expect } from "vitest";
import { sanitizeShareImageUrl } from "./image-url";

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
