import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadOgFonts, __resetOgFontCacheForTest } from "./fonts";

describe("loadOgFonts", () => {
  beforeEach(() => {
    __resetOgFontCacheForTest();
  });

  it("returns empty array when assetsBinding is undefined", async () => {
    const result = await loadOgFonts(undefined);
    expect(result).toEqual([]);
  });

  it("returns regular and bold entries when both fonts load successfully", async () => {
    const regularBuf = new ArrayBuffer(8);
    const boldBuf = new ArrayBuffer(16);
    const assets = {
      fetch: vi.fn(async (input: URL) => {
        const path = input.pathname;
        if (path.endsWith("Regular.ttf")) {
          return new Response(regularBuf, { status: 200 });
        }
        if (path.endsWith("Bold.ttf")) {
          return new Response(boldBuf, { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    } as unknown as Parameters<typeof loadOgFonts>[0];

    const fonts = await loadOgFonts(assets);
    expect(fonts).toHaveLength(2);
    expect(fonts[0].name).toBe("NotoSansJP");
    expect(fonts[0].weight).toBe(400);
    expect(fonts[0].style).toBe("normal");
    expect(fonts[0].data.byteLength).toBe(8);
    expect(fonts[1].weight).toBe(700);
    expect(fonts[1].data.byteLength).toBe(16);
  });

  it("caches the result across calls (module-scope FONT_CACHE)", async () => {
    const assets = {
      fetch: vi.fn(async () => new Response(new ArrayBuffer(4), { status: 200 })),
    } as unknown as Parameters<typeof loadOgFonts>[0];

    const first = await loadOgFonts(assets);
    const second = await loadOgFonts(assets);
    expect(first).toBe(second);
    // 2 fetch (regular + bold) on first call, no extra fetch on second call.
    expect((assets as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch).toHaveBeenCalledTimes(2);
  });

  it("returns empty array when one of the font fetches returns non-2xx", async () => {
    const assets = {
      fetch: vi.fn(async (input: URL) => {
        if (input.pathname.endsWith("Bold.ttf")) {
          return new Response(null, { status: 404 });
        }
        return new Response(new ArrayBuffer(4), { status: 200 });
      }),
    } as unknown as Parameters<typeof loadOgFonts>[0];

    const fonts = await loadOgFonts(assets);
    expect(fonts).toEqual([]);
  });

  it("returns empty array when assetsBinding.fetch throws", async () => {
    const assets = {
      fetch: vi.fn(async () => {
        throw new Error("network down");
      }),
    } as unknown as Parameters<typeof loadOgFonts>[0];

    const fonts = await loadOgFonts(assets);
    expect(fonts).toEqual([]);
  });
});
