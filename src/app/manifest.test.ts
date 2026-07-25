import { describe, expect, test } from "vitest";
import manifest from "./manifest";

describe("PWA manifest", () => {
  const m = manifest();

  test("is installable: standalone display, wallet start_url, name", () => {
    expect(m.name).toBe("FraserPay");
    expect(m.short_name).toBe("FraserPay");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/wallet");
    expect(m.scope).toBe("/");
  });

  test("declares light theme and background colors", () => {
    expect(m.theme_color).toBe("#ffffff");
    expect(m.background_color).toBe("#ffffff");
  });

  test("ships 192 and 512 icons in both any and maskable purposes", () => {
    const icons = m.icons ?? [];
    for (const purpose of ["any", "maskable"] as const) {
      for (const sizes of ["192x192", "512x512"] as const) {
        expect(
          icons.some((i) => i.sizes === sizes && i.purpose === purpose && i.type === "image/png"),
        ).toBe(true);
      }
    }
    expect(icons.every((i) => i.src.startsWith("/icons/"))).toBe(true);
  });
});
