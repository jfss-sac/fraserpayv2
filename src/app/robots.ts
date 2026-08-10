import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/server/site";

export const AI_CRAWLERS = [
  "AI2Bot",
  "Amazonbot",
  "anthropic-ai",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "cohere-ai",
  "cohere-training-data-crawler",
  "Diffbot",
  "DuckAssistBot",
  "FacebookBot",
  "Google-Extended",
  "GPTBot",
  "ImagesiftBot",
  "Kangaroo Bot",
  "meta-externalagent",
  "meta-externalfetcher",
  "MistralAI-User",
  "OAI-SearchBot",
  "omgili",
  "omgilibot",
  "PanguBot",
  "Perplexity-User",
  "PerplexityBot",
  "SemrushBot-OCOB",
  "Timpibot",
  "YouBot",
];

export const PUBLIC_PATHS = ["/login"];

export const CRAWLABLE_PATHS = ["/$", ...PUBLIC_PATHS];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {
    rules: [
      { userAgent: "*", allow: CRAWLABLE_PATHS, disallow: "/" },
      { userAgent: AI_CRAWLERS, disallow: "/" },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
