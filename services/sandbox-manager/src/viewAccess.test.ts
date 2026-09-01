import { describe, expect, it } from "vitest";
import { ViewAccess } from "./viewAccess.js";

describe("sandbox view capabilities", () => {
  const access = new ViewAccess("a-test-secret-at-least-16-chars", "http://127.0.0.1:4330");

  it("creates deterministic session-scoped HMAC tokens", () => {
    const token = access.token("session-one");
    expect(access.token("session-one")).toBe(token);
    expect(access.token("session-two")).not.toBe(token);
    expect(access.validate("session-one", token)).toBe(true);
    expect(access.validate("session-one", `${token.slice(0, -1)}x`)).toBe(false);
    expect(access.validate("session-two", token)).toBe(false);
  });

  it("returns a chrome-free computer URL routed entirely through the manager", () => {
    const url = new URL(access.viewUrl("session-one"));
    expect(url.origin).toBe("http://127.0.0.1:4330");
    expect(url.pathname).toMatch(/^\/view\/session-one\/[A-Za-z0-9_-]+\/relay\.html$/);
    expect(url.searchParams.get("path")).toMatch(/^view\/session-one\/[A-Za-z0-9_-]+\/websockify$/);
    expect(access.validate("session-one", url.pathname.split("/")[3])).toBe(true);
  });

  it("rejects malformed identifiers without exposing the secret", () => {
    expect(() => access.viewUrl("../escape")).toThrow();
    expect(access.validate("../escape", "anything")).toBe(false);
  });
});
