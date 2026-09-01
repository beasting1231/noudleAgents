import { describe, expect, it } from "vitest";
import { buildSandboxApp } from "./server.js";

describe("sandbox manager authentication", () => {
  it("keeps control routes behind the internal bearer token", async () => {
    const app = await buildSandboxApp();
    try {
      const list = await app.inject({ method: "GET", url: "/v1/sandboxes" });
      expect(list.statusCode).toBe(401);
      expect(list.json()).toEqual({ error: "unauthorized" });

      const create = await app.inject({
        method: "POST",
        url: "/v1/sandboxes",
        payload: { id: "unauthorized", workspaceKey: "test", browser: true },
      });
      expect(create.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("uses capability validation instead of the internal bearer token for views", async () => {
    const app = await buildSandboxApp();
    try {
      const response = await app.inject({ method: "GET", url: "/view/example/invalid/vnc.html" });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
