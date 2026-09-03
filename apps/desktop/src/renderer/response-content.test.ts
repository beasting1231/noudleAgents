import { describe, expect, it } from "vitest";
import { diffCounts } from "./ResponseContent";

describe("response diff rendering", () => {
  it("counts changed lines without treating file headers as edits", () => {
    expect(diffCounts("--- a/file.ts\n+++ b/file.ts\n@@ -1 +1,2 @@\n-old\n+new\n+extra")).toEqual({ additions: 2, deletions: 1 });
  });
});
