import "server-only";

export const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export type LogLevel = keyof typeof LOG_LEVELS;

export interface LogRecord {
  event: string;
  requestId?: string;
  route?: string;
  actorUid?: string;
  latencyMs?: number;
  code?: string;
  entryId?: string;
  amountCents?: number;
  type?: string;
  err?: unknown;
}

function threshold(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined;
  return configured && configured in LOG_LEVELS ? LOG_LEVELS[configured] : LOG_LEVELS.info;
}

function normalizeErr(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}

export function log(level: LogLevel, record: LogRecord): void {
  if (LOG_LEVELS[level] < threshold()) return;
  const { err, ...rest } = record;
  const line: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ...rest,
  };
  if (err !== undefined) line.err = normalizeErr(err);
  console.log(JSON.stringify(line));
}

export const logger = {
  debug: (record: LogRecord) => log("debug", record),
  info: (record: LogRecord) => log("info", record),
  warn: (record: LogRecord) => log("warn", record),
  error: (record: LogRecord) => log("error", record),
};
