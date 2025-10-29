// meta: component: loyalty-nudge-rail
"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";

import type { LoyaltyNudgeCard } from "@smplat/types";

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  push: "Push"
};

export type LoyaltyNudgeResolveStatus = "acknowledged" | "dismissed";

export type LoyaltyNudgeRailProps = {
  title: string;
  subtitle: string;
  nudges: LoyaltyNudgeCard[];
  onResolve: (card: LoyaltyNudgeCard, status: LoyaltyNudgeResolveStatus) => void;
  dataTestId?: string;
};

export function LoyaltyNudgeRail({
  title,
  subtitle,
  nudges,
  onResolve,
  dataTestId = "loyalty-nudges"
}: LoyaltyNudgeRailProps) {
  if (nudges.length === 0) {
    return null;
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-6" data-testid={dataTestId}>
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <p className="text-sm text-white/60">{subtitle}</p>
        </div>
        <span className="text-xs uppercase tracking-[0.2em] text-white/50">{nudges.length} active</span>
      </header>
      <div className="mt-5 space-y-3">
        {nudges.map((nudge) => {
          const mapping = NUDGE_TYPE_COPY[nudge.nudgeType] ?? {
            label: "Reminder",
            badge: "bg-white/10 text-white/70"
          };
          const expiryCopy = nudge.expiresAt
            ? formatDistanceToNow(new Date(nudge.expiresAt), { addSuffix: true })
            : "Action needed";

          return (
            <article key={nudge.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/50">
                <span className={`rounded-full px-3 py-1 text-[0.65rem] font-semibold ${mapping.badge}`}>
                  {mapping.label}
                </span>
                <span>{expiryCopy}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {nudge.channels.map((channel) => (
                  <span
                    key={`${nudge.id}-${channel}`}
                    className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.25em] text-white/60"
                  >
                    {CHANNEL_LABELS[channel] ?? channel}
                  </span>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                <p className="text-sm font-semibold text-white">{nudge.headline}</p>
                <p className="text-xs text-white/60">{nudge.body}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {nudge.ctaHref ? (
                  <Link
                    href={nudge.ctaHref}
                    className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                  >
                    {nudge.ctaLabel ?? "View details"}
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => onResolve(nudge, "acknowledged")}
                  className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:border-white/60 hover:text-white"
                >
                  Mark done
                </button>
                <button
                  type="button"
                  onClick={() => onResolve(nudge, "dismissed")}
                  className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/60 transition hover:border-white/60 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const NUDGE_TYPE_COPY: Record<string, { label: string; badge: string }> = {
  expiring_points: {
    label: "Expiring",
    badge: "bg-amber-500/20 text-amber-200"
  },
  checkout_reminder: {
    label: "Checkout",
    badge: "bg-sky-500/20 text-sky-200"
  },
  redemption_follow_up: {
    label: "Redemption",
    badge: "bg-fuchsia-500/20 text-fuchsia-200"
  }
};
