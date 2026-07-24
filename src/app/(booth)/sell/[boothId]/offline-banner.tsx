export function OfflineBanner() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="sticky top-0 z-40 -mx-6 flex flex-col gap-0.5 bg-danger px-6 py-3 text-background shadow-lg"
    >
      <span className="text-lg font-bold">You&apos;re offline</span>
      <span className="text-sm font-medium">
        Charging is paused and resumes automatically when you reconnect. Your cart is safe.
      </span>
    </div>
  );
}
