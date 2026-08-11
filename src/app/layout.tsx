import type { Metadata, Viewport } from "next";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, sitePath, siteOrigin } from "@/lib/server/site";
import { ToastProvider } from "@/lib/ui/toast";
import "./globals.css";

const SHARE_TITLE = `${SITE_NAME} — ${SITE_TAGLINE}`;

export async function generateMetadata(): Promise<Metadata> {
  const [origin, path] = await Promise.all([siteOrigin(), sitePath()]);
  return {
    metadataBase: new URL(origin),
    title: { default: SHARE_TITLE, template: `%s · ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    appleWebApp: { capable: true, statusBarStyle: "default", title: SITE_NAME },
    formatDetection: { telephone: false, email: false, address: false },
    robots: { index: false, follow: false, nocache: true },
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: SHARE_TITLE,
      description: SITE_DESCRIPTION,
      url: path,
      locale: "en_CA",
    },
    twitter: { card: "summary_large_image", title: SHARE_TITLE, description: SITE_DESCRIPTION },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
