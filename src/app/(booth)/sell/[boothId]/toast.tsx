"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/lib/ui/vendor/button";

export const TOAST_DURATION_MS = 5000;

export type ToastVariant = "success" | "error";

export interface Toast {
  id: string;
  message: string;
  variant: ToastVariant;
}

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((message: string, variant: ToastVariant) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, variant }]);
    return id;
  }, []);

  return { toasts, push, dismiss };
}

function ToastItem({
  toast,
  onDismiss,
  duration,
}: {
  toast: Toast;
  onDismiss: (id: string) => void;
  duration: number;
}) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration]);

  return (
    <div
      role={toast.variant === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-lg px-4 py-3 text-base font-medium shadow-lg ${
        toast.variant === "error" ? "bg-danger text-background" : "bg-success text-background"
      }`}
    >
      <span>{toast.message}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0"
      >
        ✕
      </Button>
    </div>
  );
}

export function Toaster({
  toasts,
  onDismiss,
  duration = TOAST_DURATION_MS,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  duration?: number;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} duration={duration} />
      ))}
    </div>
  );
}
