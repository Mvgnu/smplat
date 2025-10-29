"use client";

// meta: component: checkout-recovery-banner

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import type { CheckoutOrchestration } from "@smplat/types";

const stageDescriptions: Record<string, { title: string; description: string }> = {
  payment: {
    title: "Payment confirmation",
    description: "We’re verifying your payment details and preparing your receipt."
  },
  verification: {
    title: "Identity verification",
    description: "Additional verification is required before we can finalize your redemption."
  },
  loyalty_hold: {
    title: "Loyalty hold",
    description: "We’re reserving loyalty rewards while the checkout completes."
  },
  fulfillment: {
    title: "Fulfillment",
    description: "Operators are packaging perks and preparing fulfillment."
  },
  completed: {
    title: "Completed",
    description: "Checkout orchestration is finished."
  }
};

type CheckoutRecoveryBannerProps = {
  orchestration: CheckoutOrchestration | null;
  pendingIntents: number;
  loading: boolean;
  error: string | null;
};

export function CheckoutRecoveryBanner({
  orchestration,
  pendingIntents,
  loading,
  error
}: CheckoutRecoveryBannerProps) {
  if (loading) {
    return (
      <div
        className="rounded-xl border border-border/60 bg-muted/40 p-4 animate-pulse"
        role="status"
        aria-live="polite"
      >
        <div className="h-5 w-48 rounded bg-muted" />
        <div className="mt-3 h-4 w-full rounded bg-muted" />
        <div className="mt-2 h-4 w-2/3 rounded bg-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/60 bg-destructive/10 p-4 text-destructive">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-5 w-5" />
          Failed to load checkout recovery status. We’ll retry automatically.
        </div>
      </div>
    );
  }

  if (!orchestration || orchestration.status === "completed") {
    return null;
  }

  const stageMeta = stageDescriptions[orchestration.currentStage] ?? stageDescriptions.payment;
  const nextAction = orchestration.nextActionAt
    ? formatDistanceToNow(new Date(orchestration.nextActionAt), { addSuffix: true })
    : null;
  const latestEvent = useMemo(() => {
    if (!orchestration.events.length) {
      return null;
    }
    return orchestration.events[orchestration.events.length - 1];
  }, [orchestration.events]);

  const statusLabel = orchestration.status.replace("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());

  return (
    <section className="rounded-xl border border-border/60 bg-background/80 p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground/70">
            <Clock className="h-4 w-4" />
            Checkout recovery in progress
          </div>
          <h2 className="mt-2 text-xl font-semibold text-foreground">{stageMeta.title}</h2>
          <p className="mt-1 text-sm text-foreground/80">{stageMeta.description}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-2 text-sm font-medium text-foreground">
          Status: {statusLabel}
        </div>
      </div>

      {latestEvent && (
        <div className="mt-4 rounded-lg border border-border/50 bg-muted/30 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            {latestEvent.note ?? "Updated"}
          </div>
          <div className="mt-1 text-foreground/70">
            Recorded {formatDistanceToNow(new Date(latestEvent.createdAt), { addSuffix: true })}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-3 text-sm text-foreground/80 md:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
          <p className="font-medium text-foreground">What happens next</p>
          {nextAction ? (
            <p className="mt-1">We’ll check back {nextAction} to keep things moving.</p>
          ) : (
            <p className="mt-1">We’ll keep monitoring this checkout and notify you when it changes.</p>
          )}
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
          <p className="font-medium text-foreground">Need to take action?</p>
          {pendingIntents > 0 ? (
            <p className="mt-1">
              You still have {pendingIntents} open {pendingIntents === 1 ? "step" : "steps"} in your loyalty
              inbox. Review them from the loyalty hub or the nudge rail below.
            </p>
          ) : (
            <p className="mt-1">No outstanding actions on your side right now. We’ll send an alert if that changes.</p>
          )}
        </div>
      </div>
    </section>
  );
}
