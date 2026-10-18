"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A short notice at the foot of the window, with at most one action (decision
 * 175). The region is an `<output>`, always mounted and polite, so a screen reader announces
 * the message when it appears without moving focus to it.
 */

export interface ToastMessage {
  message: string;
  action?: { label: string; run: () => void };
}

const LIFETIME_MS = 8_000;

/** One toast at a time: a new one replaces the last and restarts the clock. */
export function useToast() {
  const [toast, setToast] = useState<(ToastMessage & { id: number }) | null>(null);
  const next = useRef(0);
  const show = useCallback((message: ToastMessage) => {
    next.current += 1;
    setToast({ ...message, id: next.current });
  }, []);
  const close = useCallback(() => setToast(null), []);
  return { toast, show, close };
}

export function Toast({
  toast,
  onClose,
}: {
  toast: (ToastMessage & { id: number }) | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  return (
    <output
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
    >
      {toast ? (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-4 rounded-lg border border-line bg-bg-raised px-4 py-2.5 font-ui text-sm text-fg shadow-lg"
        >
          <span>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.run();
                onClose();
              }}
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            aria-label="Dismiss"
            className="text-fg-muted hover:text-fg"
          >
            ×
          </button>
        </div>
      ) : null}
    </output>
  );
}
