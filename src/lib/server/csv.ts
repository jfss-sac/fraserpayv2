import "server-only";

const FORMULA_PREFIX = /^[=+\-@]/;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (typeof value === "object") return JSON.stringify(value) ?? "";
  return String(value);
}

export function escapeCsvCell(value: unknown): string {
  return `"${cellText(value).replaceAll('"', '""')}"`;
}

export function csvLine(values: readonly unknown[]): string {
  return `${values.map(escapeCsvCell).join(",")}\r\n`;
}

export function csvDocument(rows: readonly (readonly unknown[])[]): string {
  return rows.map(csvLine).join("");
}

export function csvDownloadHeaders(filename: string, extra?: Record<string, string>): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${filename}"`,
    "content-type": "text/csv; charset=utf-8",
    ...extra,
  });
}

export function csvStream(rows: readonly (readonly unknown[])[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = rows[Symbol.iterator]();
  return new ReadableStream({
    pull(controller) {
      const next = iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(csvLine(next.value)));
    },
  });
}
