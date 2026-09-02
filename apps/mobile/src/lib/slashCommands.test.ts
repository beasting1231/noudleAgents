import { describe, expect, it } from "vitest";

import { exactSlashCommand, matchingSlashCommands } from "./slashCommands";

describe("mobile slash commands", () => {
  it("offers clear while typing a command", () => {
    expect(matchingSlashCommands("/").map(({ value }) => value)).toEqual(["/clear"]);
    expect(matchingSlashCommands("/cl").map(({ value }) => value)).toEqual(["/clear"]);
  });

  it("does not open for messages or command arguments", () => {
    expect(matchingSlashCommands("hello")).toEqual([]);
    expect(matchingSlashCommands("/clear now")).toEqual([]);
  });

  it("only executes an exact command", () => {
    expect(exactSlashCommand(" /CLEAR ")).toBe("/clear");
    expect(exactSlashCommand("/cl")).toBeNull();
  });
});
