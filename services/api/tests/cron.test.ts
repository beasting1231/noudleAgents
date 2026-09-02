import { describe, expect, it } from "vitest";
import { nextCronOccurrence, normalizeCronExpression, validateTimezone } from "../src/schedules/cron.js";

describe("cron schedules", () => {
  it("supports intervals, aliases, weekday lists, ranges, and steps", () => {
    expect(normalizeCronExpression(" */5   * * * * ")).toBe("*/5 * * * *");
    expect(nextCronOccurrence("*/5 * * * *", "UTC", new Date("2026-09-02T10:02:15.000Z"))).toBe("2026-09-02T10:05:00.000Z");
    expect(nextCronOccurrence("30 10 * * wed,sat", "UTC", new Date("2026-09-02T10:30:00.000Z"))).toBe("2026-09-05T10:30:00.000Z");
    expect(nextCronOccurrence("0 9 * * 1-5", "UTC", new Date("2026-09-04T09:00:00.000Z"))).toBe("2026-09-07T09:00:00.000Z");
    expect(nextCronOccurrence("0 9 * * 5-7", "UTC", new Date("2026-09-04T09:00:00.000Z"))).toBe("2026-09-05T09:00:00.000Z");
  });

  it("rejects malformed expressions and unknown timezones", () => {
    expect(() => normalizeCronExpression("every day")).toThrow(/five-field cron expression/i);
    expect(() => normalizeCronExpression("61 * * * *")).toThrow(/between 0 and 59/i);
    expect(() => validateTimezone("Moon/Sea_of_Tranquility")).toThrow(/Unknown IANA timezone/i);
  });
});
