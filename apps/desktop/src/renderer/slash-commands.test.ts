import { describe, expect, it } from "vitest";
import { moveCommandSelection, resolveComposerEnter } from "./slash-commands";

describe("slash command selection", () => {
  it("does not select an item until an arrow key is used", () => {
    expect(moveCommandSelection(null, 1, 1)).toBe(0);
    expect(moveCommandSelection(null, -1, 2)).toBe(1);
  });

  it("wraps an existing selection", () => {
    expect(moveCommandSelection(0, -1, 2)).toBe(1);
    expect(moveCommandSelection(1, 1, 2)).toBe(0);
  });
});

describe("slash command activation", () => {
  it("ignores Enter while a partial command has no selection", () => {
    expect(resolveComposerEnter("/", true, ["/clear"], null)).toEqual({ type: "ignore" });
  });

  it("submits a selected command immediately", () => {
    expect(resolveComposerEnter("/", true, ["/clear"], 0)).toEqual({
      type: "submit-command",
      value: "/clear",
    });
  });

  it("submits a fully typed command immediately", () => {
    expect(resolveComposerEnter(" /CLEAR ", true, ["/clear"], null)).toEqual({
      type: "submit-command",
      value: "/clear",
    });
  });

  it("keeps normal Enter behavior when the command menu is closed", () => {
    expect(resolveComposerEnter("hello", false, [], null)).toEqual({ type: "submit-message" });
  });
});
