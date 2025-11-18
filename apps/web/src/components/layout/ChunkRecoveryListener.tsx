"use client";

import { useEffect } from "react";

export function ChunkRecoveryListener() {
  useEffect(() => {
    let hasReloaded = false;

    function shouldHandle(reason: unknown): boolean {
      if (!reason) return false;
      const message = typeof reason === "string" ? reason : (reason as Error).message;
      return typeof message === "string" && message.includes("ChunkLoadError");
    }

    function handleError(reason: unknown) {
      if (hasReloaded || !shouldHandle(reason)) {
        return;
      }
      hasReloaded = true;
      window.location.reload();
    }

    const rejectionListener = (event: PromiseRejectionEvent) => handleError(event.reason);
    const errorListener = (event: ErrorEvent) => handleError(event.error ?? event.message);

    window.addEventListener("unhandledrejection", rejectionListener);
    window.addEventListener("error", errorListener);

    return () => {
      window.removeEventListener("unhandledrejection", rejectionListener);
      window.removeEventListener("error", errorListener);
    };
  }, []);

  return null;
}
