import { describe, expect, it } from "vitest";

import { SYNC_INTERVAL_MS } from "./syncPolicy";

describe("mobile sync policy", () => {
  it("meets the one-second cross-device update target", () => {
    expect(SYNC_INTERVAL_MS).toBeLessThanOrEqual(1000);
  });
});
