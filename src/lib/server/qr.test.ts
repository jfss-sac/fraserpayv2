import { describe, expect, test } from "vitest";
import jsQR from "jsqr";
import { encodeQrMatrix, renderPaymentQrSvg } from "./qr";
import { generatePaymentCode } from "./paymentCode";

function rasterize(
  matrix: { size: number; modules: boolean[][] },
  scale: number,
  quiet: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const dim = (matrix.size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (!matrix.modules[r][c]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((r + quiet) * scale + dy) * dim + ((c + quiet) * scale + dx);
          data[px * 4] = 0;
          data[px * 4 + 1] = 0;
          data[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { data, width: dim, height: dim };
}

function decode(data: string): string | null {
  const img = rasterize(encodeQrMatrix(data), 6, 4);
  return jsQR(img.data, img.width, img.height)?.data ?? null;
}

describe("encodeQrMatrix", () => {
  test("round-trips a payment code through the jsQR decoder", () => {
    const code = generatePaymentCode();
    expect(decode(code)).toBe(code);
  });

  test("round-trips 50 random payment codes", () => {
    for (let i = 0; i < 50; i++) {
      const code = generatePaymentCode();
      expect(decode(code)).toBe(code);
    }
  });

  test("round-trips short and mixed payloads across versions", () => {
    for (const payload of ["A", "fp1-0", "hello world", "0123456789ABCDEFGHJKMNPQRSTVWX"]) {
      expect(decode(payload)).toBe(payload);
    }
  });

  test("selects a 29x29 (version 3) symbol for a 30-character payment code", () => {
    const code = generatePaymentCode();
    expect(code).toHaveLength(30);
    expect(encodeQrMatrix(code).size).toBe(29);
  });

  test("rejects a payload that exceeds version 3 capacity", () => {
    expect(() => encodeQrMatrix("x".repeat(43))).toThrow(/too large/);
  });
});

describe("renderPaymentQrSvg", () => {
  test("emits a self-contained inline SVG with a quiet zone and no inline styles", () => {
    const svg = renderPaymentQrSvg("fp1-ABCDEFGHJKMNPQRSTVWXYZ0123");
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain('viewBox="0 0 37 37"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Payment QR code"');
    expect(svg).toContain("<path");
    expect(svg).not.toContain("style=");
    expect(svg).not.toContain("<script");
  });

  test("escapes the aria label", () => {
    const svg = renderPaymentQrSvg("fp1-0", { label: 'A & B "<x>"' });
    expect(svg).toContain('aria-label="A &amp; B &quot;&lt;x&gt;&quot;"');
  });
});
