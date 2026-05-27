import { describe, it, expect } from "vitest";
import { isSafeInternalPath, resolveAuthRedirectTarget } from "./redirect";

describe("isSafeInternalPath", () => {
  it("allows simple internal paths", () => {
    expect(isSafeInternalPath("/dm/battle")).toBe(true);
    expect(isSafeInternalPath("/pokepoke/home")).toBe(true);
    expect(isSafeInternalPath("/account")).toBe(true);
  });

  it("allows internal paths with query string", () => {
    expect(isSafeInternalPath("/dm/stats?scope=team&member=abc")).toBe(true);
    expect(isSafeInternalPath("/share/abc?foo=bar")).toBe(true);
  });

  it("rejects null / undefined / empty", () => {
    expect(isSafeInternalPath(null)).toBe(false);
    expect(isSafeInternalPath(undefined)).toBe(false);
    expect(isSafeInternalPath("")).toBe(false);
  });

  it("rejects too long paths", () => {
    const tooLong = "/" + "a".repeat(512);
    expect(isSafeInternalPath(tooLong)).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(isSafeInternalPath("//evil.example/path")).toBe(false);
    expect(isSafeInternalPath("//evil.example")).toBe(false);
  });

  it("rejects encoded protocol-relative URLs", () => {
    expect(isSafeInternalPath("%2F%2Fevil.example")).toBe(false);
  });

  it("rejects external URLs with scheme", () => {
    expect(isSafeInternalPath("http://evil.example")).toBe(false);
    expect(isSafeInternalPath("https://evil.example")).toBe(false);
    expect(isSafeInternalPath("/http://evil.example")).toBe(false);
    expect(isSafeInternalPath("/https://evil.example")).toBe(false);
  });

  it("rejects javascript: and other dangerous schemes", () => {
    expect(isSafeInternalPath("javascript:alert(1)")).toBe(false);
    expect(isSafeInternalPath("/javascript:alert(1)")).toBe(false);
    expect(isSafeInternalPath("data:text/html,<script>")).toBe(false);
    expect(isSafeInternalPath("mailto:foo@example.com")).toBe(false);
  });

  it("rejects /auth and /auth/...", () => {
    expect(isSafeInternalPath("/auth")).toBe(false);
    expect(isSafeInternalPath("/auth/")).toBe(false);
    expect(isSafeInternalPath("/auth/callback")).toBe(false);
    expect(isSafeInternalPath("/auth?next=/dm/battle")).toBe(false);
  });

  it("rejects /api and /api/...", () => {
    expect(isSafeInternalPath("/api")).toBe(false);
    expect(isSafeInternalPath("/api/internal/foo")).toBe(false);
    expect(isSafeInternalPath("/api?foo=bar")).toBe(false);
  });

  it("rejects backslash", () => {
    expect(isSafeInternalPath("/dm\\battle")).toBe(false);
    expect(isSafeInternalPath("/dm%5Cbattle")).toBe(false);
  });

  it("rejects control characters", () => {
    expect(isSafeInternalPath("/dm/battle\x00")).toBe(false);
    expect(isSafeInternalPath("/dm/battle\x0d\x0a")).toBe(false);
    expect(isSafeInternalPath("/dm/battle%00")).toBe(false);
    expect(isSafeInternalPath("/dm/battle%0D%0A")).toBe(false);
  });

  it("rejects malformed percent encoding", () => {
    expect(isSafeInternalPath("/%")).toBe(false);
    expect(isSafeInternalPath("/%E0%A4%A")).toBe(false);
    expect(isSafeInternalPath("/%G0")).toBe(false);
    expect(isSafeInternalPath("/%2F%")).toBe(false);
    expect(isSafeInternalPath("/dm/%C0%AF")).toBe(false);
  });
});

describe("resolveAuthRedirectTarget", () => {
  it("returns valid next path", () => {
    const params = new URLSearchParams("next=/dm/battle");
    expect(resolveAuthRedirectTarget(params, "dm")).toBe("/dm/battle");
  });

  it("returns default when next is missing", () => {
    const params = new URLSearchParams("");
    expect(resolveAuthRedirectTarget(params, "dm")).toBe("/dm/battle");
    expect(resolveAuthRedirectTarget(params, "pokepoke")).toBe("/pokepoke/battle");
  });

  it("returns default when next is unsafe", () => {
    const params = new URLSearchParams("next=https://evil.example");
    expect(resolveAuthRedirectTarget(params, "pokepoke")).toBe("/pokepoke/battle");
  });

  it("returns default when next is protocol-relative", () => {
    const params = new URLSearchParams("next=//evil.example");
    expect(resolveAuthRedirectTarget(params, "dm")).toBe("/dm/battle");
  });

  it("returns default for /auth loop", () => {
    const params = new URLSearchParams("next=/auth?next=/dm/battle");
    expect(resolveAuthRedirectTarget(params, "dm")).toBe("/dm/battle");
  });

  it("accepts a minimal ReadOnlySearchParamsLike shape", () => {
    const fake = { get: (k: string) => (k === "next" ? "/pokepoke/home" : null) };
    expect(resolveAuthRedirectTarget(fake, "dm")).toBe("/pokepoke/home");
  });
});
