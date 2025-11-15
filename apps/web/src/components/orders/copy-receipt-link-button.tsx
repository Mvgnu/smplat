"use client";

import { useCallback, useState } from "react";

type CopyReceiptLinkButtonProps = {
  orderId: string;
  orderNumber?: string | null;
};

export function CopyReceiptLinkButton({ orderId, orderNumber }: CopyReceiptLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleCopy = useCallback(async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const shareUrl = `${origin}/checkout/success?order=${orderId}`;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const fallbackInput = document.createElement("input");
        fallbackInput.value = shareUrl;
        document.body.appendChild(fallbackInput);
        fallbackInput.select();
        document.execCommand("copy");
        document.body.removeChild(fallbackInput);
      }
      setErrored(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (error) {
      console.warn("Failed to copy receipt link", orderNumber ?? orderId, error);
      setErrored(true);
      setTimeout(() => setErrored(false), 2500);
    }
  }, [orderId, orderNumber]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60 hover:text-white"
      aria-live="polite"
      data-testid={`copy-receipt-${orderNumber ?? orderId}`}
    >
      {errored ? "Copy failed" : copied ? "Link copied" : "Copy share link"}
    </button>
  );
}
