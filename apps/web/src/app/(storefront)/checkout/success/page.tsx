"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Gift, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import type {
  CheckoutOrchestration,
  LoyaltyCheckoutIntent,
  LoyaltyNextActionFeed,
  LoyaltyNudgeCard,
  LoyaltyNudgeFeed
} from "@smplat/types";
import {
  clearResolvedIntents,
  consumeSuccessIntents,
  persistServerFeed
} from "@/lib/loyalty/intents";
import { formatAppliedAddOnLabel } from "@/lib/product-pricing";
import { LoyaltyNudgeRail } from "@/components/loyalty/nudge-rail";
import { CheckoutRecoveryBanner } from "@/components/checkout/recovery-banner";
import { CopyReceiptLinkButton } from "@/components/orders/copy-receipt-link-button";
import { useCartStore } from "@/store/cart";
import type {
  CartAddOnSelection,
  CartOptionCalculatorPreview,
  CartOptionSelection,
  CartSelectionSnapshot,
  CartSubscriptionSelection,
} from "@/types/cart";

type RemoteOnboardingTask = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  completed_at: string | null;
};

type OnboardingJourneyResponse = {
  status: string;
  referral_code: string | null;
  tasks: RemoteOnboardingTask[];
};

type CheckoutOrderItem = {
  id: string;
  productTitle: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  selectedOptions: CartSelectionSnapshot | null;
};

type CheckoutOrderSummary = {
  id: string;
  orderNumber: string;
  currency: string;
  total: number;
  createdAt: string;
  updatedAt: string;
  notes: string | null;
  loyaltyProjectionPoints: number | null;
  items: CheckoutOrderItem[];
};

type OnboardingTask = {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
};

const ANALYTICS_ENDPOINT = "/api/analytics/onboarding-events";

const mapTask = (task: RemoteOnboardingTask): OnboardingTask => ({
  id: task.id,
  title: task.title,
  description: task.description,
  completed: task.status.toLowerCase() === "completed" || Boolean(task.completed_at)
});

function formatPoints(points?: number | null): string {
  if (typeof points !== "number") {
    return "0";
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(points);
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams();
  const clear = useCartStore((state) => state.clear);
  const orderId = searchParams.get("order");
  const projectedPointsParam = searchParams.get("projectedPoints");
  const normalizedProjectedPoints =
    projectedPointsParam && !Number.isNaN(Number(projectedPointsParam))
      ? Math.max(0, Math.round(Number(projectedPointsParam)))
      : null;
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [referralCopied, setReferralCopied] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [journeyStatus, setJourneyStatus] = useState<string | null>(null);
  const [checkoutIntents, setCheckoutIntents] = useState<LoyaltyCheckoutIntent[]>([]);
  const [intentSyncStatus, setIntentSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle");
  const [nudges, setNudges] = useState<LoyaltyNudgeCard[]>([]);
  const [orderSummary, setOrderSummary] = useState<CheckoutOrderSummary | null>(null);
  const [orderSummaryState, setOrderSummaryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [orchestration, setOrchestration] = useState<CheckoutOrchestration | null>(null);
  const [orchestrationState, setOrchestrationState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [orchestrationError, setOrchestrationError] = useState<string | null>(null);
  const loyaltyBannerPoints = useMemo(() => {
    if (normalizedProjectedPoints != null) {
      return normalizedProjectedPoints;
    }
    if (typeof orderSummary?.loyaltyProjectionPoints === "number") {
      return orderSummary.loyaltyProjectionPoints;
    }
    return null;
  }, [normalizedProjectedPoints, orderSummary?.loyaltyProjectionPoints]);

  const fallbackReferral = useMemo(() => {
    if (!orderId) {
      return "SMPLAT-REFERRAL";
    }
    const sanitized = orderId.replace(/[^a-zA-Z0-9]/g, "");
    return `SMPLAT-${sanitized.slice(0, 6).toUpperCase()}`;
  }, [orderId]);

  const hydratedReferral = referralCode ?? fallbackReferral;

  const receiptDownloadHref = useMemo(() => {
    if (!orderSummary) {
      return null;
    }
    try {
      const payload = JSON.stringify(orderSummary, null, 2);
      if (typeof window !== "undefined" && typeof window.btoa === "function") {
        const encoded = window.btoa(unescape(encodeURIComponent(payload)));
        return `data:application/json;base64,${encoded}`;
      }
      return `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`;
    } catch (error) {
      console.warn("Failed to build receipt download payload", error);
      return null;
    }
  }, [orderSummary]);

  const completedCount = tasks.filter((task) => task.completed).length;
  const checklistProgress = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
  const hasCheckoutIntents = checkoutIntents.length > 0;

  const fetchJourney = useCallback(async () => {
    if (!orderId) {
      return;
    }
    try {
      const response = await fetch(`/api/onboarding/journeys/${orderId}`);
      if (!response.ok) {
        return;
      }
      const payload = (await response.json()) as OnboardingJourneyResponse;
      setJourneyStatus(payload.status);
      setReferralCode(payload.referral_code);
      setTasks(payload.tasks.map(mapTask));
    } catch (error) {
      console.warn("Failed to fetch onboarding journey", error);
    }
  }, [orderId]);

  const recordOnboardingEvent = useCallback(
    async (eventType: string, payload: Record<string, unknown> = {}) => {
      if (!orderId) {
        return null;
      }
      const response = await fetch(ANALYTICS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, orderId, ...payload })
      });

      if (!response.ok) {
        throw new Error(`Failed to persist onboarding event: ${response.statusText}`);
      }

      return (await response.json()) as Record<string, unknown>;
    },
    [orderId]
  );

  const toggleTask = useCallback(
    async (taskId: string) => {
      const current = tasks.find((task) => task.id === taskId);
      if (!current) {
        return;
      }
      const desiredState = !current.completed;
      try {
        const response = await recordOnboardingEvent("checklist_update", {
          taskId,
          completed: desiredState
        });
        if (response?.task && typeof response.task === "object") {
          const updated = response.task as RemoteOnboardingTask;
          setTasks((previous) => previous.map((task) => (task.id === taskId ? mapTask(updated) : task)));
        } else {
          await fetchJourney();
        }
      } catch (error) {
        console.warn("Failed to update onboarding task", error);
      }
    },
    [fetchJourney, recordOnboardingEvent, tasks]
  );

  const retryIntentSync = useCallback(() => {
    if (intentSyncStatus === "error") {
      setIntentSyncStatus("idle");
    }
  }, [intentSyncStatus]);

  const dismissIntent = useCallback(
    (intentId: string) => {
      const target = checkoutIntents.find((intent) => intent.id === intentId);
      if (!target) {
        return;
      }
      setCheckoutIntents((previous) => previous.filter((intent) => intent.id !== intentId));
      clearResolvedIntents(
        (intent) => intent.id === intentId || intent.clientIntentId === target.clientIntentId
      );
      if (target.id === target.clientIntentId) {
        return;
      }

      void (async () => {
        try {
          const response = await fetch(`/api/loyalty/next-actions/${target.id}/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "cancelled" })
          });
          if (!response.ok) {
            throw new Error(await response.text());
          }
          const feedResponse = await fetch("/api/loyalty/next-actions");
          if (feedResponse.ok) {
            const feed = (await feedResponse.json()) as LoyaltyNextActionFeed;
            persistServerFeed(feed);
            setCheckoutIntents(feed.intents);
          }
        } catch (error) {
          console.warn("Failed to resolve loyalty intent", error);
        }
      })();
    },
    [checkoutIntents]
  );

  const resolveNudge = useCallback(
    (card: LoyaltyNudgeCard, status: "acknowledged" | "dismissed") => {
      setNudges((previous) => previous.filter((entry) => entry.id !== card.id));
      void (async () => {
        try {
          const response = await fetch(`/api/loyalty/nudges/${card.id}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status })
          });
          if (!response.ok) {
            throw new Error(await response.text());
          }
          const feedResponse = await fetch("/api/loyalty/nudges");
          if (feedResponse.ok) {
            const feed = (await feedResponse.json()) as LoyaltyNudgeFeed;
            setNudges(feed.nudges);
          }
        } catch (error) {
          console.warn("Failed to resolve loyalty nudge", error);
          setNudges((previous) => [card, ...previous.filter((entry) => entry.id !== card.id)]);
        }
      })();
    },
    []
  );

  const handleReferralClick = useCallback(async () => {
    const codeToCopy = hydratedReferral;
    try {
      await navigator.clipboard?.writeText(codeToCopy);
      setReferralCopied(true);
    } catch {
      setReferralCopied(true);
    }
    try {
      await recordOnboardingEvent("referral_copied", { referralCode: codeToCopy });
    } catch (error) {
      console.warn("Failed to record referral copy", error);
    }
  }, [hydratedReferral, recordOnboardingEvent]);

  useEffect(() => {
    clear();
  }, [clear]);

  useEffect(() => {
    if (!orderId) {
      setOrderSummary(null);
      setOrderSummaryState("idle");
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setOrderSummaryState("loading");

    const loadOrderSummary = async () => {
      try {
        const response = await fetch(`/api/orders/${orderId}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as CheckoutOrderSummary;
        if (!cancelled) {
          setOrderSummary(payload);
          setOrderSummaryState("ready");
        }
      } catch (error) {
        if (cancelled || error instanceof DOMException) {
          return;
        }
        console.warn("Failed to load checkout order summary", error);
        if (!cancelled) {
          setOrderSummary(null);
          setOrderSummaryState("error");
        }
      }
    };

    void loadOrderSummary();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [orderId]);

  useEffect(() => {
    if (!orderId) {
      setOrchestration(null);
      setOrchestrationState("idle");
      setOrchestrationError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setOrchestrationState("loading");

    const loadOrchestration = async () => {
      try {
        const response = await fetch(`/api/checkout/orchestrations/${orderId}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const payload = (await response.json()) as CheckoutOrchestration;
        if (!cancelled) {
          setOrchestration(payload);
          setOrchestrationState("ready");
          setOrchestrationError(null);
        }
      } catch (error) {
        if (cancelled || error instanceof DOMException) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to load checkout orchestration";
        setOrchestration(null);
        setOrchestrationState("error");
        setOrchestrationError(message);
      }
    };

    void loadOrchestration();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [orderId]);

  useEffect(() => {
    const intents = consumeSuccessIntents(orderId);
    if (intents.length > 0) {
      setCheckoutIntents(intents);
    }
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    const loadServerFeed = async () => {
      try {
        const response = await fetch("/api/loyalty/next-actions");
        if (!response.ok) {
          return;
        }
        const feed = (await response.json()) as LoyaltyNextActionFeed;
        persistServerFeed(feed);
        if (!cancelled) {
          setCheckoutIntents(feed.intents);
        }
      } catch (error) {
        console.warn("Failed to fetch checkout next actions", error);
      }
    };

    void loadServerFeed();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadNudges = async () => {
      try {
        const response = await fetch("/api/loyalty/nudges", {
          headers: { Accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) {
          return;
        }
        const feed = (await response.json()) as LoyaltyNudgeFeed;
        if (!cancelled) {
          setNudges(feed.nudges);
        }
      } catch (error) {
        if (!(error instanceof DOMException)) {
          console.warn("Failed to fetch loyalty nudges", error);
        }
      }
    };

    const interval = window.setInterval(() => {
      void loadNudges();
    }, 45_000);

    void loadNudges();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (checkoutIntents.length === 0) {
      setIntentSyncStatus("idle");
    }
  }, [checkoutIntents.length]);

  useEffect(() => {
    if (!orderId || checkoutIntents.length === 0 || intentSyncStatus !== "idle") {
      return;
    }

    let cancelled = false;
    const syncIntents = async () => {
      setIntentSyncStatus("syncing");
      try {
        const response = await fetch("/api/loyalty/checkout-intents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, intents: checkoutIntents, action: "confirm" })
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Failed to sync loyalty intents");
        }
        const feed = (await response.json()) as LoyaltyNextActionFeed;
        persistServerFeed(feed);
        if (!cancelled) {
          setCheckoutIntents(feed.intents);
          setIntentSyncStatus("synced");
        }
      } catch (error) {
        console.warn("Failed to sync checkout loyalty intents", error);
        if (!cancelled) {
          setIntentSyncStatus("error");
        }
      }
    };

    void syncIntents();
    return () => {
      cancelled = true;
    };
  }, [orderId, checkoutIntents, intentSyncStatus]);

  useEffect(() => {
    if (!orderId) {
      return;
    }
    void fetchJourney();
  }, [fetchJourney, orderId]);

  useEffect(() => {
    if (!orderId) {
      return;
    }
    void recordOnboardingEvent("journey_started").then(() => fetchJourney()).catch(() => fetchJourney());
  }, [orderId, recordOnboardingEvent, fetchJourney]);

  useEffect(() => {
    if (!referralCopied) {
      return;
    }
    const timeout = setTimeout(() => setReferralCopied(false), 3000);
    return () => clearTimeout(timeout);
  }, [referralCopied]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-20 text-white">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white">
          <Sparkles className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-3xl font-semibold">Payment confirmed</h1>
        <p className="mt-3 text-white/70">
          Your SMPLAT operators are scheduling the kickoff sprint. Complete onboarding below to keep momentum.
        </p>
        {orderId ? (
          <p className="mt-2 text-sm text-white/50">Order reference: {orderId}</p>
        ) : null}
        {journeyStatus ? (
          <p className="mt-2 text-xs uppercase tracking-[0.3em] text-white/40">Journey status: {journeyStatus}</p>
        ) : null}
        {loyaltyBannerPoints != null ? (
          <p className="mt-4 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            This order earned approximately {loyaltyBannerPoints.toLocaleString("en-US")} loyalty points.
          </p>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-white/20 px-4 py-3 text-sm text-white/60">
            Loyalty projection will appear here shortly after checkout. You can still review your receipt below.
          </p>
        )}
      </section>

      {orderSummaryState !== "idle" ? (
        <section className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Order summary</h2>
              <p className="text-sm text-white/60">
                We saved the exact blueprint selections from checkout so you can share, analyze, or revisit them later.
              </p>
            </div>
            {orderSummary?.orderNumber ? (
              <span className="text-xs uppercase tracking-[0.3em] text-white/40">
                #{orderSummary.orderNumber}
              </span>
            ) : null}
          </header>

          {orderSummary?.id ? (
            <div className="flex flex-wrap gap-2 text-[11px] text-white/70">
              <CopyReceiptLinkButton orderId={orderSummary.id} orderNumber={orderSummary.orderNumber ?? orderSummary.id} />
              {receiptDownloadHref ? (
                <a
                  href={receiptDownloadHref}
                  download={`smplat-order-${orderSummary.orderNumber ?? orderSummary.id}.json`}
                  className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white"
                >
                  Download JSON
                </a>
              ) : null}
            </div>
          ) : null}

          {orderSummaryState === "loading" ? (
            <p className="text-sm text-white/60">Loading your receipt blueprint…</p>
          ) : orderSummaryState === "error" ? (
            <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
              We couldn’t load this order’s selections automatically. Refresh to try again, or contact support with your
              order reference.
            </div>
          ) : orderSummary && orderSummary.items.length > 0 ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between text-sm text-white/60">
                <span>
                  Placed {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(orderSummary.createdAt))}
                </span>
                <span className="text-base font-semibold text-white">
                  {formatCurrency(orderSummary.total, orderSummary.currency)}
                </span>
              </div>
              <div className="space-y-3">
                {orderSummary.items.map((item) => {
                    const blueprint = item.selectedOptions;
                  const hasBlueprint =
                    Boolean(blueprint?.options?.length) ||
                    Boolean(blueprint?.addOns?.length) ||
                    Boolean(blueprint?.subscriptionPlan);

                  return (
                    <article key={item.id} className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
                      <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-base font-semibold text-white">{item.productTitle}</p>
                          <p className="text-xs text-white/50">
                            {item.quantity} × {formatCurrency(item.unitPrice, orderSummary.currency)}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-white">
                          {formatCurrency(item.totalPrice, orderSummary.currency)}
                        </span>
                      </div>

                      {blueprint?.options?.length ? (
                        <div className="space-y-2">
                          <p className="text-xs uppercase tracking-wide text-white/40">Blueprint options</p>
                          <ul className="space-y-2">
                            {blueprint.options.map((selection) => {
                              const deltaLabel =
                                selection.priceDelta !== 0
                                  ? `${selection.priceDelta > 0 ? "+" : "-"}${formatCurrency(
                                      Math.abs(selection.priceDelta),
                                      orderSummary.currency
                                    )}`
                                  : "included";
                              return (
                                <li
                                  key={`${selection.groupId}-${selection.optionId}`}
                                  className="space-y-1 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60"
                                >
                                  <div className="flex items-start justify-between gap-3 text-sm text-white">
                                    <span>
                                      {selection.groupName}:{" "}
                                      <span className="text-white/70">{selection.label}</span>
                                    </span>
                                    <span className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
                                      {deltaLabel}
                                    </span>
                                  </div>
                                  {selection.marketingTagline ? (
                                    <p className="text-sm text-white/70">{selection.marketingTagline}</p>
                                  ) : null}
                                  {selection.fulfillmentSla ? (
                                    <p className="text-xs text-white/50">SLA: {selection.fulfillmentSla}</p>
                                  ) : null}
                                  {selection.heroImageUrl ? (
                                    <p className="truncate text-[0.65rem] text-white/40">
                                      Hero asset: {selection.heroImageUrl}
                                    </p>
                                  ) : null}
                                  {selection.calculator ? (
                                    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[0.65rem] text-white/60">
                                      <p className="uppercase tracking-[0.3em] text-white/40">Calculator</p>
                                      <code className="block text-sm text-white/70">{selection.calculator.expression}</code>
                                      {selection.calculator.sampleResult != null ? (
                                        <p className="mt-1">
                                          Sample {selection.calculator.sampleResult.toFixed(2)} — amount{" "}
                                          {selection.calculator.sampleAmount ?? "–"}, days{" "}
                                          {selection.calculator.sampleDays ?? "–"}
                                        </p>
                                      ) : (
                                        <p className="mt-1 text-white/40">Awaiting sample inputs</p>
                                      )}
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}

                      {blueprint?.addOns?.length ? (
                        <div className="space-y-2 text-xs text-white/60">
                          <p className="text-xs uppercase tracking-wide text-white/40">Add-ons</p>
                          <ul className="space-y-1">
                            {blueprint.addOns.map((addOn) => {
                              const labels = formatAppliedAddOnLabel(
                            {
                              mode: addOn.pricingMode,
                              amount: addOn.pricingAmount ?? null,
                              serviceId: addOn.serviceId ?? null,
                              serviceProviderName: addOn.serviceProviderName ?? null,
                              serviceAction: addOn.serviceAction ?? null,
                              serviceDescriptor: addOn.serviceDescriptor ?? null,
                              previewQuantity: addOn.previewQuantity ?? null,
                            },
                                addOn.priceDelta,
                                orderSummary.currency
                              );
                              return (
                                <li key={addOn.id} className="space-y-1">
                                  <span className="text-white/70">{addOn.label}</span> {labels.primary}
                                  {labels.secondary ? ` (${labels.secondary})` : ""}
                                  {addOn.previewQuantity != null || addOn.payloadTemplate ? (
                                    <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[0.65rem] text-white/60">
                                      {addOn.previewQuantity != null ? (
                                        <p>Preview quantity: {addOn.previewQuantity}</p>
                                      ) : null}
                                      {addOn.payloadTemplate ? (
                                        <details>
                                          <summary className="cursor-pointer text-white/50">Payload template</summary>
                                          <pre className="mt-1 max-h-32 overflow-auto text-white/50">
                                            {JSON.stringify(addOn.payloadTemplate, null, 2)}
                                          </pre>
                                        </details>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}

                      {blueprint?.subscriptionPlan ? (
                        <div className="space-y-1 text-xs text-white/60">
                          <p className="text-xs uppercase tracking-wide text-white/40">Subscription plan</p>
                          <p className="text-sm text-white/70">{blueprint.subscriptionPlan.label}</p>
                          <p>
                            Billing: {blueprint.subscriptionPlan.billingCycle.replace("_", " ")}
                            {blueprint.subscriptionPlan.priceMultiplier != null
                              ? ` · multiplier ${blueprint.subscriptionPlan.priceMultiplier.toFixed(2)}`
                              : ""}
                            {blueprint.subscriptionPlan.priceDelta != null
                              ? ` · delta ${formatCurrency(
                                  blueprint.subscriptionPlan.priceDelta,
                                  orderSummary.currency
                                )}`
                              : ""}
                          </p>
                        </div>
                      ) : null}

                      {hasBlueprint ? (
                        <details className="rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/50">
                          <summary className="cursor-pointer text-white/70">Raw selection payload</summary>
                          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-white/60">
                            {JSON.stringify(blueprint, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/60">No items were recorded for this order.</p>
          )}
        </section>
      ) : null}

      <CheckoutRecoveryBanner
        orchestration={orchestration}
        pendingIntents={checkoutIntents.length}
        loading={orchestrationState === "loading" && Boolean(orderId)}
        error={orchestrationState === "error" ? orchestrationError : null}
      />

      <LoyaltyNudgeRail
        title="Real-time loyalty nudges"
        subtitle="Stay ahead with reminders tailored to your recent activity."
        nudges={nudges}
        onResolve={resolveNudge}
        dataTestId="checkout-nudges"
      />

      {hasCheckoutIntents ? (
        <section
          className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur"
          data-testid="checkout-loyalty-actions"
        >
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Keep loyalty momentum</h2>
              <p className="text-sm text-white/60">
                {intentSyncStatus === "syncing"
                  ? "Syncing checkout selections with your loyalty profile."
                  : intentSyncStatus === "error"
                    ? "We couldn’t sync automatically—follow through from the loyalty hub."
                    : "We saved your checkout selections so you can follow through without losing momentum."}
              </p>
            </div>
            {intentSyncStatus === "error" ? (
              <button
                type="button"
                onClick={retryIntentSync}
                className="inline-flex items-center justify-center rounded-full border border-white/40 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white"
              >
                Retry sync
              </button>
            ) : (
              <span className="text-xs uppercase tracking-[0.3em] text-white/40">
                {intentSyncStatus === "synced"
                  ? "Synced"
                  : intentSyncStatus === "syncing"
                    ? "Syncing…"
                    : "Pending"}
              </span>
            )}
          </header>
          <div className="space-y-3">
            {checkoutIntents.map((intent) => {
              const timestamp = intent.createdAt
                ? formatDistanceToNow(new Date(intent.createdAt), { addSuffix: true })
                : "moments ago";
              if (intent.kind === "redemption") {
                const rewardName = intent.rewardName ?? intent.rewardSlug ?? "Reward";
                const points = typeof intent.pointsCost === "number" ? formatPoints(intent.pointsCost) : null;
                return (
                  <article
                    key={intent.id}
                    className="rounded-2xl border border-white/10 bg-black/30 p-4"
                    data-testid={`checkout-intent-${intent.kind}`}
                  >
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/50">
                      <span>Redemption follow-up</span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      <p className="text-sm font-semibold text-white">{rewardName}</p>
                      <p className="text-xs text-white/60">
                        {points
                          ? `Hold ${points} points and finish fulfillment in the loyalty hub.`
                          : "Finalize your planned redemption in the loyalty hub."}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href="/account/loyalty#rewards"
                        className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                      >
                        Open rewards
                      </Link>
                      <button
                        type="button"
                        onClick={() => dismissIntent(intent.id)}
                        className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white"
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                );
              }

              const referralCodeCopy = intent.referralCode ?? "your referral";
              return (
                <article
                  key={intent.id}
                  className="rounded-2xl border border-white/10 bg-black/30 p-4"
                  data-testid={`checkout-intent-${intent.kind}`}
                >
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/50">
                    <span>Referral follow-up</span>
                    <span>{timestamp}</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    <p className="text-sm font-semibold text-white">Thank your referral</p>
                    <p className="text-xs text-white/60">
                      {intent.referralCode
                        ? `Send a thank-you or check in on ${referralCodeCopy} from the loyalty hub.`
                        : "Follow up on your referral outreach from the loyalty hub."}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href="/account/loyalty/referrals"
                      className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                    >
                      Manage referrals
                    </Link>
                    <button
                      type="button"
                      onClick={() => dismissIntent(intent.id)}
                      className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white"
                    >
                      Dismiss
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Onboarding checklist</h2>
              <p className="text-sm text-white/60">Complete the tasks so your pod can launch without delays.</p>
            </div>
            <span className="text-sm text-white/60">{checklistProgress}%</span>
          </div>
          <ul className="mt-4 space-y-3">
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => void toggleTask(task.id)}
                  className="flex w-full items-start gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-left transition hover:border-white/30"
                >
                  <CheckCircle2
                    className={`h-5 w-5 flex-shrink-0 ${task.completed ? "text-emerald-300" : "text-white/30"}`}
                  />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-white">{task.title}</p>
                    <p className="text-sm text-white/70">{task.description}</p>
                  </div>
                </button>
              </li>
            ))}
            {tasks.length === 0 ? (
              <li>
                <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-white/50">
                  Onboarding tasks will appear here once your operator pod provisions them.
                </div>
              </li>
            ) : null}
          </ul>
        </article>

        <article className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-lg font-semibold text-white">Asset checklist</h2>
          <p className="text-sm text-white/70">Operators need a few items to wire analytics and creative automation:</p>
          <ul className="space-y-2 text-sm text-white/70">
            <li>• Brand guide or tone prompts for copywriting safeguards.</li>
            <li>• Access to product drive or sample creative for UGC sourcing.</li>
            <li>• Instagram/TikTok account access and any compliance notes.</li>
          </ul>
          <Link
            href="mailto:concierge@smplat.com"
            className="inline-flex w-fit items-center gap-2 rounded-full border border-white/30 px-5 py-2 text-sm font-semibold text-white transition hover:border-white/60"
          >
            <Sparkles className="h-4 w-4" /> Email concierge desk
          </Link>
        </article>
      </section>

      <section className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Referral incentive</h2>
            <p className="text-sm text-white/60">Invite a peer. When they onboard, both teams receive a sprint credit.</p>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-white/20 bg-black/30 px-4 py-2">
            <code className="text-sm font-mono text-white">{hydratedReferral}</code>
            <button
              type="button"
              onClick={() => void handleReferralClick()}
              className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-semibold text-black transition hover:bg-white/90"
            >
              <Gift className="h-4 w-4" /> Copy
            </button>
          </div>
        </div>
        {referralCopied ? (
          <p className="text-xs text-emerald-200">Referral code copied. Share it with your next brand partner!</p>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            Enter client portal
          </Link>
          <Link
            href="/products"
            className="inline-flex items-center rounded-full border border-white/30 px-5 py-2 text-sm font-semibold text-white transition hover:border-white/60"
          >
            Explore additional services
          </Link>
        </div>
        <p className="text-xs text-white/60">
          Operators monitor checklist progress and will nudge you via Slack if we see a stall.
        </p>
      </section>
    </main>
  );
}
