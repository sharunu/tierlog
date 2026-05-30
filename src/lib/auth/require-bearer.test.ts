// Plan E / E-2: Plan D auth helper の純関数 isMissingFunctionError の test。
// requireBearer 本体は I/O (Supabase / NextRequest) のため対象外。純関数のみ (RD-E2)。
import { describe, it, expect } from "vitest";
import { isMissingFunctionError } from "./require-bearer";

describe("isMissingFunctionError", () => {
  it("returns true for PostgREST PGRST202 code", () => {
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true);
    // message が無くても code だけで true
    expect(isMissingFunctionError({ code: "PGRST202", message: null })).toBe(true);
  });

  it("returns true for 'Could not find the function' message", () => {
    expect(
      isMissingFunctionError({
        message:
          "Could not find the function public.account_access_state(p_uid) in the schema cache",
      }),
    ).toBe(true);
  });

  it("returns true for 'schema cache' message", () => {
    expect(
      isMissingFunctionError({ message: "Searched for function in the schema cache, not found" }),
    ).toBe(true);
  });

  it("returns true when message has both 'function' and 'does not exist'", () => {
    expect(
      isMissingFunctionError({ message: "function account_access_state(uuid) does not exist" }),
    ).toBe(true);
  });

  it("returns false for ordinary errors (network / permission)", () => {
    expect(isMissingFunctionError({ code: "42501", message: "permission denied for function" })).toBe(
      false,
    );
    expect(isMissingFunctionError({ message: "fetch failed" })).toBe(false);
    expect(isMissingFunctionError({ message: "JWT expired" })).toBe(false);
  });

  it("returns false when only one of 'function' / 'does not exist' is present", () => {
    // "function" だけ (does not exist 無し) → false
    expect(isMissingFunctionError({ message: "function call timed out" })).toBe(false);
    // "does not exist" だけ (function 無し) → false (別オブジェクトの欠落等)
    expect(isMissingFunctionError({ message: "relation does not exist" })).toBe(false);
  });

  it("returns false for null / empty boundaries", () => {
    expect(isMissingFunctionError({ code: null, message: null })).toBe(false);
    expect(isMissingFunctionError({ code: null, message: "" })).toBe(false);
    expect(isMissingFunctionError({})).toBe(false);
  });
});
