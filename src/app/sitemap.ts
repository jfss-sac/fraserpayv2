import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/server/site";
import { PUBLIC_PATHS } from "./robots";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin();
  return PUBLIC_PATHS.map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: "yearly" as const,
    priority: 1,
  }));
}
