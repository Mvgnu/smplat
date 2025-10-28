"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Gift, Sparkles } from "lucide-react";

import { useCartStore } from "@/store/cart";

type OnboardingTask = {
  id: string;
  title: string;
  description: string;
  completed: boolean;
};

const DEFAULT_TASKS: Array<Omit<OnboardingTask, "completed">> = [
  {
    id: "intake",
    title: "Submit campaign intake",
    description:
      "Share campaign goals, budget guardrails, and target audiences so operators configure the right experiment lanes.",
  },
  {
    id: "assets",
    title: "Upload creative & access assets",
    description: "Drop logos, product shots, and sample posts into the asset locker and grant Instagram/TikTok access.",
  },
  {
    id: "collaboration",
    title: "Connect collaboration channels",
    description: "Accept the Slack Connect invite, confirm reporting recipients, and note any compliance constraints.",
  },
];

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams();
  const clear = useCartStore((state) => state.clear);
  const orderId = searchParams.get("order");
  const [tasks, setTasks] = useState<OnboardingTask[]>(() =>
    DEFAULT_TASKS.map((task) => ({ ...task, completed: false }))
  );
  const [referralCopied, setReferralCopied] = useState(false);

  const referralCode = useMemo(() => {
    if (!orderId) {
      return "SMPLAT-REFERRAL";
    }
    const sanitized = orderId.replace(/[^a-zA-Z0-9]/g, "");
    return `SMPLAT-${sanitized.slice(0, 6).toUpperCase()}`;
  }, [orderId]);

  const completedCount = tasks.filter((task) => task.completed).length;
  const checklistProgress = Math.round((completedCount / tasks.length) * 100);

  const recordOnboardingEvent = useCallback(
    async (eventType: string, payload: Record<string, unknown> = {}) => {
      try {
        await fetch("/api/analytics/onboarding-events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType, orderId, ...payload }),
        });
      } catch (error) {
        console.warn("Failed to record onboarding event", error);
      }
    },
    [orderId]
  );

  const toggleTask = (taskId: string) => {
    setTasks((previous) => {
      const updated = previous.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task
      );
      const updatedTask = updated.find((task) => task.id === taskId);
      void recordOnboardingEvent("checklist_update", {
        taskId,
        completed: updatedTask?.completed ?? false,
      });
      return updated;
    });
  };

  const handleReferralClick = async () => {
    try {
      await navigator.clipboard?.writeText(referralCode);
      setReferralCopied(true);
    } catch {
      setReferralCopied(true);
    }
    void recordOnboardingEvent("referral_copied", { referralCode });
  };

  useEffect(() => {
    clear();
  }, [clear]);

  useEffect(() => {
    void recordOnboardingEvent("journey_started");
  }, [orderId, recordOnboardingEvent]);

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
      </section>

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
                  onClick={() => toggleTask(task.id)}
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
            <code className="text-sm font-mono text-white">{referralCode}</code>
            <button
              type="button"
              onClick={handleReferralClick}
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
