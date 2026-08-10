import { Suspense } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { GoogleSignIn } from "@/lib/ui/google-signin";
import {
  SITE_ALTERNATE_NAMES,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  serializeJsonLd,
  siteOrigin,
} from "@/lib/server/site";

const LOGIN_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

const LOGIN_DESCRIPTION = `${SITE_DESCRIPTION} Sign in with your school Google account to see your balance, payment QR code and purchase history.`;

export const metadata: Metadata = {
  title: { absolute: LOGIN_TITLE },
  description: LOGIN_DESCRIPTION,
  robots: { index: true, follow: true },
};

// Rendered per request so the proxy's CSP nonce is stamped onto the framework
// scripts; a static prerender would ship non-nonced scripts that the CSP blocks.
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const origin = await siteOrigin();

  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: SITE_NAME,
        alternateName: SITE_ALTERNATE_NAMES,
        url: origin,
        description: SITE_DESCRIPTION,
        inLanguage: "en-CA",
      },
      {
        "@type": "WebApplication",
        "@id": `${origin}/#app`,
        name: SITE_NAME,
        alternateName: SITE_ALTERNATE_NAMES,
        url: origin,
        description: SITE_DESCRIPTION,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript and a school Google account",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "CAD" },
        isPartOf: { "@id": `${origin}/#website` },
        potentialAction: { "@type": "LoginAction", target: `${origin}/login` },
      },
    ],
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="text-2xl font-bold text-foreground">FraserPay</h1>
        <p className="mt-1 text-sm text-muted">{SITE_TAGLINE}</p>
        <p className="mt-4 mb-6 text-sm text-muted">Sign in with your PDSB account to continue.</p>
        <Suspense>
          <GoogleSignIn />
        </Suspense>
      </div>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
    </main>
  );
}
