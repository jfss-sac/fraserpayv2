import { beforeEach, describe, expect, test, vi } from "vitest";

const { headers } = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock("next/headers", () => ({ headers }));

vi.mock("@/lib/ui/google-signin", () => ({ GoogleSignIn: () => null }));

import RootLayout, { generateMetadata } from "./layout";
import robots, { AI_CRAWLERS, CRAWLABLE_PATHS } from "./robots";
import sitemap from "./sitemap";
import { metadata as loginMetadata } from "./(public)/login/page";

const ORIGIN = "https://pay.example.ca";

function mockRequest(pathname: string): void {
  headers.mockResolvedValue(
    new Headers({ host: "pay.example.ca", "x-forwarded-proto": "https", "x-pathname": pathname }),
  );
}

beforeEach(() => {
  headers.mockReset();
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("root layout document", () => {
  test("declares the document language", () => {
    const tree = RootLayout({ children: null }) as { props: { lang: string } };
    expect(tree.props.lang).toBe("en");
  });
});

describe("root metadata", () => {
  test("sets an absolute metadataBase so og:image and canonical resolve", async () => {
    mockRequest("/wallet");
    const meta = await generateMetadata();
    expect(new URL(meta.metadataBase!).origin).toBe(ORIGIN);
  });

  test("carries a real description, not a placeholder repeat of the title", async () => {
    mockRequest("/wallet");
    const meta = await generateMetadata();
    expect(typeof meta.description).toBe("string");
    expect(meta.description).not.toBe("FraserPay");
    expect((meta.description as string).length).toBeGreaterThan(50);
  });

  test("brands every page title through a template while keeping titles distinct", async () => {
    mockRequest("/wallet");
    const title = (await generateMetadata()).title as { default: string; template: string };
    expect(title.default).toContain("FraserPay");
    expect(title.template).toBe("%s · FraserPay");
  });

  test("canonical and og:url follow the requested path", async () => {
    mockRequest("/admin/booths");
    const meta = await generateMetadata();
    expect(meta.alternates?.canonical).toBe("/admin/booths");
    expect(meta.openGraph?.url).toBe("/admin/booths");
  });

  test("defaults every authenticated route to noindex", async () => {
    mockRequest("/wallet");
    const meta = await generateMetadata();
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  test("declares an openGraph card so a shared link unfurls", async () => {
    mockRequest("/");
    const meta = await generateMetadata();
    expect(meta.openGraph?.siteName).toBe("FraserPay");
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  test("ignores a spoofed Host header rather than emitting it as canonical", async () => {
    headers.mockResolvedValue(
      new Headers({ host: "evil.example.ca/<script>", "x-pathname": "/wallet" }),
    );
    const meta = await generateMetadata();
    expect(new URL(meta.metadataBase!).origin).toBe("http://localhost:3000");
  });
});

describe("login metadata", () => {
  test("is the one route that opts back in to indexing", () => {
    expect(loginMetadata.robots).toMatchObject({ index: true, follow: true });
  });

  test("does not redeclare openGraph or twitter", () => {
    expect(loginMetadata.openGraph).toBeUndefined();
    expect(loginMetadata.twitter).toBeUndefined();
  });

  test("leads its title with the brand and does not double it via the template", () => {
    const title = loginMetadata.title as { absolute: string };
    expect(title.absolute.startsWith("FraserPay")).toBe(true);
    expect(title.absolute.match(/FraserPay/g)).toHaveLength(1);
  });

  test("describes what FraserPay is, not just that you can sign in", () => {
    const description = String(loginMetadata.description);
    expect(description).toContain("FraserPay");
    expect(description).toMatch(/sign in/i);
    expect(description.length).toBeGreaterThan(120);
  });
});

describe("robots.txt", () => {
  test("disallows everything except the sign-in page for general crawlers", async () => {
    mockRequest("/robots.txt");
    const rules = (await robots()).rules as Array<{
      userAgent?: string | string[];
      allow?: string | string[];
      disallow?: string | string[];
    }>;
    const wildcard = rules.find((r) => r.userAgent === "*");
    expect(wildcard?.disallow).toBe("/");
    expect(wildcard?.allow).toEqual(CRAWLABLE_PATHS);
  });

  test("lets crawlers fetch the bare origin so the redirect to /login is followable", async () => {
    mockRequest("/robots.txt");
    const rules = (await robots()).rules as Array<{
      userAgent?: string | string[];
      allow?: string | string[];
    }>;
    expect(rules.find((r) => r.userAgent === "*")?.allow).toContain("/$");
  });

  test("blocks AI and training crawlers on every path", async () => {
    mockRequest("/robots.txt");
    const rules = (await robots()).rules as Array<{
      userAgent?: string | string[];
      allow?: string | string[];
      disallow?: string | string[];
    }>;
    const ai = rules.find((r) => Array.isArray(r.userAgent));
    expect(ai?.disallow).toBe("/");
    expect(ai?.allow).toBeUndefined();
    for (const bot of ["GPTBot", "ClaudeBot", "Google-Extended", "CCBot", "PerplexityBot"]) {
      expect(AI_CRAWLERS).toContain(bot);
    }
  });

  test("points at an absolute sitemap URL", async () => {
    mockRequest("/robots.txt");
    expect((await robots()).sitemap).toBe(`${ORIGIN}/sitemap.xml`);
  });
});

describe("sitemap.xml", () => {
  test("lists the public routes as absolute URLs and nothing behind auth", async () => {
    mockRequest("/sitemap.xml");
    const entries = await sitemap();
    expect(entries.map((e) => e.url)).toEqual([`${ORIGIN}/login`]);
  });
});
