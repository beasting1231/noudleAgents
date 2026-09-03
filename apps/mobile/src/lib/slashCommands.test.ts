import { describe, expect, it } from "vitest";

import { exactSlashCommand, matchingSlashCommands } from "./slashCommands";

describe("mobile slash commands", () => {
  it("offers clear while typing a command", () => {
    expect(matchingSlashCommands("/").map(({ value }) => value)).toEqual(["/clear", "/stop"]);
    expect(matchingSlashCommands("/cl").map(({ value }) => value)).toEqual(["/clear"]);
    expect(matchingSlashCommands("/st").map(({ value }) => value)).toEqual(["/stop"]);
  });

  it("does not open for messages or command arguments", () => {
    expect(matchingSlashCommands("hello")).toEqual([]);
    expect(matchingSlashCommands("/clear now")).toEqual([]);
  });

  it("only executes an exact command", () => {
    expect(exactSlashCommand(" /CLEAR ")).toBe("/clear");
    expect(exactSlashCommand(" /STOP ")).toBe("/stop");
    expect(exactSlashCommand("/cl")).toBeNull();
  });
});
