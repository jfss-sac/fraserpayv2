import { TIMEZONE } from "@/lib/shared/constants";

export type FeedTimePreset = "15m" | "30m" | "60m" | "today";

export interface FeedTimeRange {
  from: string;
  to: string;
  label: string;
}

const TORONTO_DATE_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const TORONTO_PARTS_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const RANGE_LABEL_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

const PRESET_MINUTES: Record<Exclude<FeedTimePreset, "today">, number> = {
  "15m": 15,
  "30m": 30,
  "60m": 60,
};

function partsOf(formatter: Intl.DateTimeFormat, date: Date): Record<string, string> {
  return Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
}

function torontoDateKey(date: Date): string {
  const parts = partsOf(TORONTO_DATE_FORMAT, date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return [next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");
}

function torontoMidnight(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const utcGuessMs = Date.UTC(year, month - 1, day);
  const localParts = partsOf(TORONTO_PARTS_FORMAT, new Date(utcGuessMs));
  const localAsUtcMs = Date.UTC(
    Number(localParts.year),
    Number(localParts.month) - 1,
    Number(localParts.day),
    Number(localParts.hour),
    Number(localParts.minute),
    Number(localParts.second),
  );
  const offsetMs = localAsUtcMs - utcGuessMs;
  return new Date(utcGuessMs - offsetMs).toISOString();
}

export function feedTimeRangeForPreset(
  preset: FeedTimePreset,
  now: Date = new Date(),
): FeedTimeRange {
  if (preset === "today") {
    const fromKey = torontoDateKey(now);
    return {
      from: torontoMidnight(fromKey),
      to: torontoMidnight(nextDateKey(fromKey)),
      label: "Today",
    };
  }

  const minutes = PRESET_MINUTES[preset];
  return {
    from: new Date(now.getTime() - minutes * 60_000).toISOString(),
    to: now.toISOString(),
    label: `Last ${minutes} min`,
  };
}

export function customFeedTimeRange(fromValue: string, toValue: string): FeedTimeRange | null {
  const fromMs = Date.parse(fromValue);
  const toMs = Date.parse(toValue);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs) return null;

  const from = new Date(fromMs);
  const to = new Date(toMs);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    label: `Custom · ${RANGE_LABEL_FORMAT.format(from)} – ${RANGE_LABEL_FORMAT.format(to)}`,
  };
}
