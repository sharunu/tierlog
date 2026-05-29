// Plan E / E-2: Plan D auth helper (AuthExpiredError / handleAuthExpiredError) の純関数 test。
// environment: node のまま。jsdom / RTL は導入しない (RD-E2)。
// window は vi.stubGlobal で stub し、afterEach の vi.unstubAllGlobals で素の node 状態へ復元する。
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AuthExpiredError,
  handleAuthExpiredError,
  AUTH_EXPIRED_EVENT_NAME,
} from "./auth-expired-error";

describe("AuthExpiredError", () => {
  it("sets name / message / reason and is an Error", () => {
    const err = new AuthExpiredError("jwt_expired");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AuthExpiredError);
    expect(err.name).toBe("AuthExpiredError");
    expect(err.message).toBe("auth_expired: jwt_expired");
    expect(err.reason).toBe("jwt_expired");
  });

  it("preserves an empty reason", () => {
    const err = new AuthExpiredError("");
    expect(err.message).toBe("auth_expired: ");
    expect(err.reason).toBe("");
  });
});

describe("handleAuthExpiredError", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false under SSR (window undefined) without dispatching", () => {
    // node 環境では window は元から undefined。SSR 経路を表す。
    expect(typeof window).toBe("undefined");
    expect(handleAuthExpiredError(new AuthExpiredError("jwt_expired"))).toBe(false);
  });

  it("dispatches tierlog:auth-expired once and returns true for AuthExpiredError", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    const result = handleAuthExpiredError(new AuthExpiredError("session_missing"));

    expect(result).toBe(true);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent<{ reason: string }>;
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe(AUTH_EXPIRED_EVENT_NAME);
    expect(event.detail.reason).toBe("session_missing");
  });

  it("returns false and does not dispatch for non-AuthExpiredError", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });

    expect(handleAuthExpiredError(new Error("generic failure"))).toBe(false);
    expect(handleAuthExpiredError("just a string")).toBe(false);
    expect(handleAuthExpiredError(null)).toBe(false);
    expect(handleAuthExpiredError(undefined)).toBe(false);
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
