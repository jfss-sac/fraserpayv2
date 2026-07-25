import { Suspense } from "react";
import type { Metadata } from "next";
import { GoogleSignIn } from "@/lib/ui/google-signin";

export const metadata: Metadata = {
  title: "Sign in to FraserPay",
};

// Rendered per request so the proxy's CSP nonce is stamped onto the framework
// scripts; a static prerender would ship non-nonced scripts that the CSP blocks.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="text-2xl font-bold text-foreground">FraserPay</h1>
        <p className="mt-2 mb-6 text-sm text-muted">Sign in with your PDSB account to continue.</p>
        <Suspense>
          <GoogleSignIn />
        </Suspense>
      </div>
    </main>
  );
}
