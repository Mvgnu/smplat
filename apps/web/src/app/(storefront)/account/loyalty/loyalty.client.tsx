"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";

import type {
  LoyaltyLedgerEntry,
  LoyaltyLedgerPage,
  LoyaltyMemberSummary,
  LoyaltyRedemption,
  LoyaltyRedemptionPage,
  LoyaltyReward,
  LoyaltyNextActionCard,
  LoyaltyNextActionFeed,
  ReferralConversionPage
} from "@smplat/types";

import { requestRedemption } from "./loyalty.actions";
import {
  clearResolvedIntents,
  consumeLoyaltyNextActions,
  persistServerFeed
} from "@/lib/loyalty/intents";

const POINTS_DISPLAY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const REFERRAL_REWARD_POINTS = 500;

type TimelineEvent =
  | {
      kind: "ledger";
      id: string;
      occurredAt: string;
      ledger: LoyaltyLedgerEntry;
    }
  | {
      kind: "redemption";
      id: string;
      occurredAt: string;
      redemption: LoyaltyRedemption;
    };

const LEDGER_TYPE_COPY: Record<string, string> = {
  earn: "Points earned",
  redeem: "Redemption applied",
  adjustment: "Balance adjustment",
  referral_bonus: "Referral bonus",
  tier_bonus: "Tier milestone"
};

const REDEMPTION_STATUS_COPY: Record<string, string> = {
  requested: "Pending",
  fulfilled: "Fulfilled",
  failed: "Failed",
  cancelled: "Cancelled"
};

const REDEMPTION_STATUS_CLASS: Record<string, string> = {
  requested: "bg-amber-400/20 text-amber-200",
  fulfilled: "bg-emerald-400/20 text-emerald-200",
  failed: "bg-red-500/20 text-red-200",
  cancelled: "bg-slate-400/20 text-slate-200"
};

// surface: loyalty-history
function buildTimeline(
  ledger: LoyaltyLedgerPage,
  redemptions: LoyaltyRedemptionPage,
  optimistic: LoyaltyRedemption[]
): TimelineEvent[] {
  const ledgerEvents: TimelineEvent[] = ledger.entries.map((entry) => ({
    kind: "ledger",
    id: `ledger-${entry.id}`,
    occurredAt: entry.occurredAt,
    ledger: entry
  }));

  const redemptionMap = new Map<string, LoyaltyRedemption>();
  [...optimistic, ...redemptions.redemptions].forEach((item) => {
    if (!redemptionMap.has(item.id)) {
      redemptionMap.set(item.id, item);
    }
  });

  const redemptionEvents: TimelineEvent[] = Array.from(redemptionMap.values()).map((redemption) => ({
    kind: "redemption",
    id: `redemption-${redemption.id}`,
    occurredAt: redemption.requestedAt,
    redemption
  }));

  return [...ledgerEvents, ...redemptionEvents].sort((a, b) => {
    const left = new Date(a.occurredAt).getTime();
    const right = new Date(b.occurredAt).getTime();
    return right - left;
  });
}

type LoyaltyHubClientProps = {
  ledger: LoyaltyLedgerPage;
  member: LoyaltyMemberSummary;
  redemptions: LoyaltyRedemptionPage;
  referrals: ReferralConversionPage;
  rewards: LoyaltyReward[];
  nextActions: LoyaltyNextActionFeed;
};

type RedemptionFormState = {
  optimisticBalance: number;
  optimisticOnHold: number;
  lastRedemption?: LoyaltyRedemption;
  optimisticRedemptions: LoyaltyRedemption[];
  error?: string;
};

const initialState = (member: LoyaltyMemberSummary): RedemptionFormState => ({
  optimisticBalance: member.availablePoints,
  optimisticOnHold: member.pointsOnHold,
  optimisticRedemptions: [],
  lastRedemption: undefined,
  error: undefined
});

export function LoyaltyHubClient({
  ledger,
  member,
  redemptions,
  referrals,
  rewards,
  nextActions: nextActionFeed
}: LoyaltyHubClientProps) {
  const [isRedeeming, startRedeem] = useTransition();
  const [state, setState] = useState<RedemptionFormState>(() => initialState(member));
  const [copiedCode, setCopiedCode] = useState(false);
  const [nextActions, setNextActions] = useState<LoyaltyNextActionCard[]>(
    nextActionFeed.cards
  );

  const sortedRewards = useMemo(
    () => rewards.filter((reward) => reward.isActive).sort((a, b) => a.costPoints - b.costPoints),
    [rewards]
  );

  const rewardById = useMemo(() => {
    const entries = rewards.map((reward) => [reward.id, reward] as const);
    return new Map(entries);
  }, [rewards]);

  const timelineEvents = useMemo(
    () => buildTimeline(ledger, redemptions, state.optimisticRedemptions),
    [ledger, redemptions, state.optimisticRedemptions]
  );

  const hasNextActions = nextActions.length > 0;

  const referralConverted = referrals.statusCounts.converted ?? referrals.statusCounts.CONVERTED ?? 0;
  const referralActive =
    (referrals.statusCounts.sent ?? referrals.statusCounts.SENT ?? 0) +
    (referrals.statusCounts.pending ?? referrals.statusCounts.PENDING ?? 0);
  const referralPointsEarned = useMemo(
    () => POINTS_DISPLAY.format(referrals.convertedPoints ?? 0),
    [referrals.convertedPoints]
  );
  const topReferralInvites = useMemo(
    () => referrals.invites.slice(0, 3),
    [referrals.invites]
  );

  const progressPercentage = Math.min(Math.round(member.progressToNextTier * 100), 100);

  const nextTierCopy = member.nextTier
    ? `Only ${POINTS_DISPLAY.format(Math.max(state.optimisticOnHold + state.optimisticBalance, 0))} pts away from ${member.nextTier}.`
    : "You&rsquo;ve reached the highest tier available.";

  useEffect(() => {
    persistServerFeed(nextActionFeed);
    const fallback = consumeLoyaltyNextActions();
    if (nextActionFeed.cards.length > 0) {
      setNextActions(nextActionFeed.cards);
    } else if (fallback.length > 0) {
      setNextActions(fallback);
    } else {
      setNextActions([]);
    }
  }, [nextActionFeed]);

  const dismissNextAction = useCallback((id: string) => {
    setNextActions((previous) => previous.filter((action) => action.id !== id));
    clearResolvedIntents((intent) => intent.id === id || intent.clientIntentId === id);
    void (async () => {
      try {
        const response = await fetch(`/api/loyalty/next-actions/${id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "resolved" })
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
        const feedResponse = await fetch("/api/loyalty/next-actions");
        if (feedResponse.ok) {
          const feed = (await feedResponse.json()) as LoyaltyNextActionFeed;
          persistServerFeed(feed);
          setNextActions(feed.cards);
        }
      } catch (error) {
        console.warn("Failed to resolve loyalty next action", error);
      }
    })();
  }, []);

  const handleRedeem = (reward: LoyaltyReward) => {
    if (isRedeeming) {
      return;
    }

    if (reward.costPoints > state.optimisticBalance) {
      setState((previous) => ({
        ...previous,
        error: "Not enough available points for this reward."
      }));
      return;
    }

    setState((previous) => ({
      optimisticBalance: Math.max(previous.optimisticBalance - reward.costPoints, 0),
      optimisticOnHold: previous.optimisticOnHold + reward.costPoints,
      lastRedemption: previous.lastRedemption,
      optimisticRedemptions: previous.optimisticRedemptions,
      error: undefined
    }));

    startRedeem(async () => {
      try {
        const redemption = await requestRedemption({ rewardSlug: reward.slug, quantity: 1 });
        setState((previous) => ({
          optimisticBalance: previous.optimisticBalance,
          optimisticOnHold: previous.optimisticOnHold,
          lastRedemption: redemption,
          optimisticRedemptions: [
            redemption,
            ...previous.optimisticRedemptions.filter((existing) => existing.id !== redemption.id)
          ],
          error: undefined
        }));
      } catch (error) {
        setState((previous) => ({
          optimisticBalance: member.availablePoints,
          optimisticOnHold: member.pointsOnHold,
          lastRedemption: undefined,
          optimisticRedemptions: previous.optimisticRedemptions,
          error: error instanceof Error ? error.message : "Unable to create redemption"
        }));
      }
    });
  };

  return (
    <div className="space-y-12" data-testid="loyalty-hub">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/30">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-white/50">Tier progression</p>
            <h2 className="text-2xl font-semibold">{member.currentTier ?? "Starter"}</h2>
          </div>
          <div className="text-right text-sm text-white/70">
            <p>Lifetime points: {POINTS_DISPLAY.format(member.lifetimePoints)}</p>
            <p>{nextTierCopy}</p>
          </div>
        </header>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-sm text-white/70">
            <span>Progress to next tier</span>
            <span>{progressPercentage}%</span>
          </div>
          <div className="h-3 w-full rounded-full bg-white/10">
            <div
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progressPercentage}
              className="h-3 rounded-full bg-gradient-to-r from-emerald-400 to-sky-400"
              role="progressbar"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>
      </section>

      {hasNextActions ? (
        <section
          className="rounded-3xl border border-white/10 bg-white/5 p-6"
          data-testid="loyalty-next-actions"
        >
          <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-white">Next actions from checkout</h3>
              <p className="text-sm text-white/60">Follow through on the loyalty moves you queued post-purchase.</p>
            </div>
            <span className="text-xs uppercase tracking-[0.2em] text-white/50">{nextActions.length} reminders</span>
          </header>
          <div className="mt-5 space-y-3">
            {nextActions.map((action) => {
              const timestamp = formatDistanceToNow(new Date(action.createdAt), { addSuffix: true });
              const metadata = (action.metadata ?? {}) as Record<string, unknown>;
              if (action.kind === "redemption") {
                const rewardName =
                  typeof metadata["rewardName"] === "string" ? (metadata["rewardName"] as string) : action.headline;
                const pointsCost =
                  typeof metadata["pointsCost"] === "number" ? (metadata["pointsCost"] as number) : undefined;
                return (
                  <article key={action.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/50">
                      <span>Redemption reminder</span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      <p className="text-sm font-semibold text-white">{rewardName}</p>
                      <p className="text-xs text-white/60">
                        {typeof pointsCost === "number"
                          ? `Reserve ${POINTS_DISPLAY.format(pointsCost)} pts and complete this reward now.`
                          : "Finish the planned redemption to capture the points you queued."}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        href="/account/loyalty#rewards"
                        className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                      >
                        {action.ctaLabel}
                      </Link>
                      <button
                        type="button"
                        onClick={() => dismissNextAction(action.id)}
                        className="inline-flex items-center justify-center rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/60 hover:text-white"
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                );
              }

              const referralCode =
                typeof metadata["referralCode"] === "string" ? (metadata["referralCode"] as string) : null;
              return (
                <article key={action.id} className="rounded-2xl border border-white/10 bg-black/30 p-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/50">
                    <span>Referral reminder</span>
                    <span>{timestamp}</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    <p className="text-sm font-semibold text-white">{action.headline}</p>
                    <p className="text-xs text-white/60">
                      {referralCode
                        ? `Close the loop with referral code ${referralCode} and thank your new customer.`
                        : action.description}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href="/account/loyalty/referrals"
                      className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-white/90"
                    >
                      {action.ctaLabel}
                    </Link>
                    <button
                      type="button"
                      onClick={() => dismissNextAction(action.id)}
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

      <section className="grid gap-6 md:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-semibold">Balances</h3>
          <dl className="mt-4 space-y-3 text-sm text-white/70">
            <div className="flex items-center justify-between">
              <dt>Available</dt>
              <dd className="text-base font-semibold text-white">
                {POINTS_DISPLAY.format(state.optimisticBalance)} pts
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>On hold</dt>
              <dd className="text-white">{POINTS_DISPLAY.format(state.optimisticOnHold)} pts</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Total balance</dt>
              <dd className="text-white">{POINTS_DISPLAY.format(member.pointsBalance)} pts</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-semibold">Expiring points</h3>
          {member.expiringPoints.length === 0 ? (
            <p className="mt-4 text-sm text-white/60">No expirations scheduled for the next 12 months.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm text-white/70">
              {member.expiringPoints.map((window) => (
                <li key={window.expiresAt} className="flex items-center justify-between">
                  <span>{POINTS_DISPLAY.format(window.points)} pts</span>
                  <span className="text-white">
                    {formatDistanceToNow(new Date(window.expiresAt), { addSuffix: true })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
          <h3 className="text-lg font-semibold">Referrals</h3>
          <p className="mt-2 text-sm text-white/70">
            Share your invite code to earn referral bonuses and thank recent conversions.
          </p>
          <dl className="mt-4 space-y-2 text-sm text-white/70">
            <div className="flex items-center justify-between">
              <dt>Converted invites</dt>
              <dd className="text-white">{referralConverted}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Active invites</dt>
              <dd className="text-white">{referralActive}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Points earned</dt>
              <dd className="text-white">{referralPointsEarned} pts</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>Last activity</dt>
              <dd className="text-white/70">
                {referrals.lastActivity
                  ? formatDistanceToNow(new Date(referrals.lastActivity), { addSuffix: true })
                  : "No activity"}
              </dd>
            </div>
          </dl>
          <div className="mt-4 space-y-2 text-xs text-white/60">
            {topReferralInvites.length === 0 ? (
              <p>No invites yet. Send your first referral to see it here.</p>
            ) : (
              topReferralInvites.map((invite) => (
                <div key={invite.id} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                  <span className="font-semibold text-white">{invite.code}</span>
                  <span className="uppercase tracking-[0.2em] text-white/60">{invite.status}</span>
                </div>
              ))
            )}
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs text-white/60">
              Your code: <span className="font-semibold text-white">{member.referralCode ?? "—"}</span>
            </p>
            <button
              className="rounded-full border border-white/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
              disabled={!member.referralCode}
              onClick={() => {
                if (!member.referralCode || typeof navigator === "undefined") {
                  return;
                }
                const clipboard = navigator.clipboard;
                if (!clipboard || typeof clipboard.writeText !== "function") {
                  return;
                }
                clipboard
                  .writeText(member.referralCode)
                  .then(() => {
                    setCopiedCode(true);
                    window.setTimeout(() => setCopiedCode(false), 2000);
                  })
                  .catch(() => setCopiedCode(false));
              }}
              type="button"
            >
              {copiedCode ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-3 text-xs text-white/60">
            Each conversion awards {POINTS_DISPLAY.format(REFERRAL_REWARD_POINTS)} pts. Send guided invites from the referrals hub.
          </p>
          <Link
            className="mt-4 inline-flex w-full items-center justify-center rounded-full border border-white/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
            href="/account/loyalty/referrals"
          >
            Manage invites
          </Link>
        </div>
      </section>

      <section
        className="rounded-3xl border border-white/10 bg-white/5 p-6"
        data-testid="loyalty-history"
      >
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-xl font-semibold">Activity timeline</h3>
            <p className="text-sm text-white/60">Ledger entries, redemption outcomes, and referral credits.</p>
          </div>
          <p className="text-right text-xs uppercase tracking-[0.2em] text-white/50">
            {timelineEvents.length > 0 ? `${timelineEvents.length} events` : "No activity"}
          </p>
        </header>
        {timelineEvents.length === 0 ? (
          <p className="mt-6 text-sm text-white/60">
            Start redeeming rewards or sharing invites to populate your history.
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {timelineEvents.slice(0, 8).map((event) => {
              const timestamp = formatDistanceToNow(new Date(event.occurredAt), { addSuffix: true });
              if (event.kind === "ledger") {
                const amount = event.ledger.amount;
                const isPositive = amount >= 0;
                const amountDisplay = `${isPositive ? "+" : "−"}${POINTS_DISPLAY.format(Math.abs(amount))} pts`;
                const amountClass = isPositive ? "text-emerald-200" : "text-red-200";
                const metadata = event.ledger.metadata ?? {};
                const tags: string[] = [];
                if (typeof metadata.referral_code === "string") {
                  tags.push(`Referral ${metadata.referral_code}`);
                }
                if (typeof metadata.redemption_id === "string") {
                  tags.push(`Redemption ${metadata.redemption_id.slice(0, 8)}`);
                }
                return (
                  <li key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/50">
                      <span>Ledger</span>
                      <span>{timestamp}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {event.ledger.description ?? LEDGER_TYPE_COPY[event.ledger.entryType] ?? event.ledger.entryType}
                        </p>
                        {tags.length > 0 ? (
                          <p className="text-xs text-white/60">{tags.join(" · ")}</p>
                        ) : null}
                      </div>
                      <span className={`text-base font-semibold ${amountClass}`}>{amountDisplay}</span>
                    </div>
                  </li>
                );
              }

              const statusKey = event.redemption.status.toLowerCase();
              const statusClass = REDEMPTION_STATUS_CLASS[statusKey] ?? "bg-white/10 text-white";
              const statusLabel = REDEMPTION_STATUS_COPY[statusKey] ?? event.redemption.status;
              const reward = event.redemption.rewardId ? rewardById.get(event.redemption.rewardId) : undefined;
              return (
                <li key={event.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-white/50">
                    <span>Redemption</span>
                    <span>{timestamp}</span>
                  </div>
                  <div className="mt-2 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-white">
                        {reward?.name ?? "Custom redemption"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
                        <span className={`rounded-full px-3 py-1 font-semibold ${statusClass}`}>{statusLabel}</span>
                        <span>{POINTS_DISPLAY.format(event.redemption.pointsCost)} pts</span>
                      </div>
                      {statusKey === "requested" ? (
                        <p className="text-xs text-white/60">Points are on hold until the redemption is fulfilled.</p>
                      ) : null}
                      {event.redemption.failureReason ? (
                        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                          Failure reason: {event.redemption.failureReason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {statusKey === "failed" && reward ? (
                        <button
                          className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={isRedeeming}
                          onClick={() => handleRedeem(reward)}
                          type="button"
                        >
                          Retry redemption
                        </button>
                      ) : null}
                      {statusKey === "fulfilled" && reward ? (
                        <a className="text-xs text-white/70 underline decoration-dotted" href="#rewards">
                          View reward
                        </a>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-6">
        <header>
          <h3 className="text-xl font-semibold" id="rewards">
            Rewards catalog
          </h3>
          <p className="text-sm text-white/60">Redeem rewards instantly. Redemptions hold points until fulfillment.</p>
        </header>
        {state.error ? (
          <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100" data-testid="loyalty-error">
            {state.error}
          </p>
        ) : null}
        {state.lastRedemption ? (
          <div
            className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100"
            data-testid="loyalty-success"
          >
            Redemption {state.lastRedemption.id.slice(0, 8)} created. We&rsquo;ll notify you when it&rsquo;s fulfilled.
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          {sortedRewards.map((reward) => (
            <article
              key={reward.id}
              className="flex h-full flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-6 transition hover:border-white/30"
            >
              <div className="space-y-3">
                <header>
                  <h4 className="text-lg font-semibold">{reward.name}</h4>
                  <p className="text-sm text-white/60">{reward.description ?? ""}</p>
                </header>
                <p className="text-sm text-white/70">Cost: {POINTS_DISPLAY.format(reward.costPoints)} pts</p>
              </div>
              <button
                className="mt-6 w-full rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:bg-white/30"
                disabled={isRedeeming || reward.costPoints > state.optimisticBalance}
                data-testid={`redeem-${reward.slug}`}
                onClick={() => handleRedeem(reward)}
                type="button"
              >
                {reward.costPoints > state.optimisticBalance ? "Insufficient points" : isRedeeming ? "Processing" : "Redeem"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
