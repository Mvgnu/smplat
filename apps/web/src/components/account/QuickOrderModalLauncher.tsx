"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { ReceiptStorageComponent } from "@/server/health/readiness";
import type { QuickOrderTelemetryContext } from "@/types/quick-order";
import { formatRelativeTimestamp } from "@/lib/delivery-proof-insights";
import { startQuickOrderSession } from "@/lib/quick-order-session";
import { trackQuickOrderAbort, trackQuickOrderStart } from "@/lib/telemetry/events";

type QuickOrderModalLauncherProps = {
  context: QuickOrderTelemetryContext | null;
  receiptStatus: ReceiptStorageComponent | null;
};

export function QuickOrderModalLauncher({ context, receiptStatus }: QuickOrderModalLauncherProps) {
  const [open, setOpen] = useState(false);
  const disabled = !context;
  const router = useRouter();
  const receiptStatusValue = receiptStatus?.status ?? null;
  const receiptDetailValue = receiptStatus?.detail ?? null;

  const quickOrderHref = useMemo(() => {
    if (!context) {
      return "/products";
    }
    const params = new URLSearchParams();
    if (context.productId) {
      params.set("quickOrderProductId", context.productId);
    }
    params.set("quickOrderProductTitle", context.productTitle);
    if (context.platformType) {
      params.set("platform", context.platformType);
    } else if (context.platformHandle) {
      params.set("platform", context.platformHandle.replace(/^@/, ""));
    }
    return `/products?${params.toString()}`;
  }, [context]);

  const handleLaunchBuilder = useCallback(() => {
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const target = new URL(quickOrderHref, baseUrl);
    let sessionId: string | null = null;
    if (context) {
      sessionId = startQuickOrderSession({ context });
      if (sessionId) {
        target.searchParams.set("quickOrderSessionId", sessionId);
      }
      void trackQuickOrderStart({
        context,
        sessionId,
        receiptStatus: receiptStatusValue,
        receiptDetail: receiptDetailValue,
      });
    }
    setOpen(false);
    router.push(`${target.pathname}${target.search}`);
  }, [context, quickOrderHref, receiptDetailValue, receiptStatusValue, router]);

  const handleCloseModal = useCallback(
    (reason: string) => {
      setOpen(false);
      void trackQuickOrderAbort({
        context,
        reason,
        stage: "modal",
        receiptStatus: receiptStatusValue,
        receiptDetail: receiptDetailValue,
      });
    },
    [context, receiptDetailValue, receiptStatusValue],
  );

  const receiptLastSuccess = formatRelativeTimestamp(receiptStatus?.lastSuccessAt ?? null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled && !receiptStatus}
        className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/80 transition hover:border-white/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        Start quick order
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick-order workflow"
            className="relative w-full max-w-2xl space-y-4 rounded-3xl border border-white/10 bg-[#08090b] p-6 text-white shadow-2xl"
          >
            <button
              type="button"
              onClick={() => handleCloseModal("dismissed")}
              className="absolute right-4 top-4 rounded-full border border-white/20 px-2 py-1 text-xs uppercase tracking-[0.3em] text-white/60 transition hover:border-white/50 hover:text-white"
            >
              Close
            </button>
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Quick-order workflow</p>
              <h3 className="text-xl font-semibold text-white">Confirm platform + blueprint</h3>
              <p className="text-sm text-white/70">
                We prefilled these selections using your latest delivery proof and automation telemetry. Launch the
                product builder to lock in new orders instantly.
              </p>
            </div>
            {context ? (
              <div className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{context.productTitle}</p>
                    <p className="text-xs text-white/60">{context.platformLabel}</p>
                  </div>
                  <span className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] uppercase tracking-[0.3em] text-white/60">
                    Platform ready
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Baseline followers</p>
                    <p className="text-2xl font-semibold text-white">{context.followerBaseline}</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                    <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Lift recorded</p>
                    <p className="text-2xl font-semibold text-white">{context.followerDelta}</p>
                    {context.lastSnapshotRelative ? (
                      <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                        Snapshot {context.lastSnapshotRelative}
                      </p>
                    ) : null}
                  </div>
                </div>
                {context.providerTelemetry ? (
                  <ul className="grid gap-3 sm:grid-cols-2 text-xs text-white/70">
                    <li className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Orders routed</p>
                      <p className="text-lg font-semibold text-white">{context.providerTelemetry.totalOrders}</p>
                    </li>
                    <li className="rounded-lg border border-white/10 bg-black/30 p-3">
                      <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Guardrail status</p>
                      <p className="text-lg font-semibold text-white">
                        {context.providerTelemetry.guardrails.fail}/{context.providerTelemetry.guardrails.evaluated} fail/evaluated
                      </p>
                    </li>
                  </ul>
                ) : (
                  <p className="text-xs text-white/60">
                    Provider telemetry will populate after your first routed automation run completes.
                  </p>
                )}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-white/20 bg-black/20 p-4 text-sm text-white/60">
                Keep running campaigns to unlock quick-order shortcuts. We’ll surface the latest delivery proof and provider telemetry once available.
              </p>
            )}
            {receiptStatus ? (
              <div className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/70">
                <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Receipt storage probe</p>
                <p className="text-base font-semibold text-white capitalize">{receiptStatus.status.replace("_", " ")}</p>
                <p>{receiptStatus.detail ?? "Receipt storage probe telemetry updated."}</p>
                {receiptLastSuccess ? (
                  <p className="text-xs text-white/50">Last successful probe {receiptLastSuccess}</p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleLaunchBuilder}
                disabled={disabled}
                className="rounded-full bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Launch builder
              </button>
              <button
                type="button"
                onClick={() => handleCloseModal("not_now")}
                className="rounded-full border border-white/30 px-5 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/60 hover:text-white"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
