import { DomainError } from "../domain/errors.js";

interface CronField {
  wildcard: boolean;
  values: Set<number>;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

const monthAliases: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const weekdayAliases: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

function cronError(message: string): never {
  throw new DomainError(400, "invalid_cron_expression", message);
}

function valueOf(raw: string, aliases: Record<string, number>, min: number, max: number): number {
  const alias = aliases[raw.toLowerCase()];
  const parsed = alias ?? Number(raw);
  if (!Number.isInteger(parsed)) cronError(`Invalid cron value '${raw}'`);
  if (parsed < min || parsed > max) cronError(`Cron value '${raw}' must be between ${min} and ${max}`);
  return parsed;
}

function parseField(raw: string, min: number, max: number, aliases: Record<string, number> = {}, sundaySeven = false): CronField {
  const field = raw.trim();
  if (!field) cronError("Cron fields cannot be empty");
  const values = new Set<number>();
  const wildcard = field === "*" || field.startsWith("*/");
  for (const segment of field.split(",")) {
    const [base, stepRaw, extra] = segment.split("/");
    if (extra !== undefined || !base) cronError(`Invalid cron segment '${segment}'`);
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1 || step > max - min + 1) cronError(`Invalid cron step '${stepRaw ?? ""}'`);

    let start: number;
    let end: number;
    if (base === "*") {
      start = min;
      end = max;
    } else if (base.includes("-")) {
      const [startRaw, endRaw, trailing] = base.split("-");
      if (!startRaw || !endRaw || trailing !== undefined) cronError(`Invalid cron range '${base}'`);
      start = valueOf(startRaw, aliases, min, max);
      end = valueOf(endRaw, aliases, min, max);
      if (end < start) cronError(`Cron range '${base}' must be ascending`);
    } else {
      start = valueOf(base, aliases, min, max);
      end = stepRaw === undefined ? start : max;
    }
    for (let value = start; value <= end; value += step) values.add(sundaySeven && value === 7 ? 0 : value);
  }
  if (values.size === 0) cronError(`Cron field '${field}' does not select any values`);
  return { wildcard, values };
}

export function normalizeCronExpression(expression: string): string {
  const normalized = expression.trim().replace(/\s+/g, " ").toLowerCase();
  const fields = normalized.split(" ");
  if (fields.length !== 5) cronError("Use a five-field cron expression: minute hour day-of-month month day-of-week");
  parseCron(normalized);
  return normalized;
}

function parseCron(expression: string): ParsedCron {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = expression.split(" ");
  if ([minute, hour, dayOfMonth, month, dayOfWeek].some((field) => field === undefined)) {
    cronError("Use a five-field cron expression: minute hour day-of-month month day-of-week");
  }
  return {
    minute: parseField(minute!, 0, 59),
    hour: parseField(hour!, 0, 23),
    dayOfMonth: parseField(dayOfMonth!, 1, 31),
    month: parseField(month!, 1, 12, monthAliases),
    dayOfWeek: parseField(dayOfWeek!, 0, 7, weekdayAliases, true),
  };
}

export function validateTimezone(timezone: string): string {
  const normalized = timezone.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: normalized }).format(new Date());
  } catch {
    throw new DomainError(400, "invalid_timezone", `Unknown IANA timezone '${normalized}'`);
  }
  return normalized;
}

export function nextCronOccurrence(expression: string, timezone: string, after: Date): string {
  const parsed = parseCron(normalizeCronExpression(expression));
  const safeTimezone = validateTimezone(timezone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  });
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  const limit = start + 5 * 366 * 24 * 60 * 60_000;
  for (let timestamp = start; timestamp <= limit; timestamp += 60_000) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
    const minute = Number(parts.minute);
    const hour = Number(parts.hour);
    const day = Number(parts.day);
    const month = Number(parts.month);
    const weekday = weekdayAliases[(parts.weekday ?? "").slice(0, 3).toLowerCase()];
    const dayOfMonthMatches = parsed.dayOfMonth.values.has(day);
    const dayOfWeekMatches = weekday !== undefined && parsed.dayOfWeek.values.has(weekday);
    const dayMatches = parsed.dayOfMonth.wildcard
      ? dayOfWeekMatches
      : parsed.dayOfWeek.wildcard
        ? dayOfMonthMatches
        : dayOfMonthMatches || dayOfWeekMatches;
    if (
      parsed.minute.values.has(minute) &&
      parsed.hour.values.has(hour) &&
      parsed.month.values.has(month) &&
      dayMatches
    ) return new Date(timestamp).toISOString();
  }
  cronError("This cron expression has no occurrence within the next five years");
}
