import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <p className="text-sm font-medium text-muted">404</p>
        <h1 className="mt-1 text-2xl font-bold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          This page does not exist, or your account does not have access to it.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground"
        >
          Back to FraserPay
        </Link>
      </div>
    </main>
  );
}
