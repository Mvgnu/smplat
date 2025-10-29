"use client";

import { useMemo, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";

import type { LoyaltyMemberSummary, LoyaltyReward, LoyaltyRedemption } from "@smplat/types";

import { requestRedemption } from "./loyalty.actions";

const POINTS_DISPLAY = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

type LoyaltyHubClientProps = {
  member: LoyaltyMemberSummary;
  rewards: LoyaltyReward[];
};

type RedemptionFormState = {
  optimisticBalance: number;
  optimisticOnHold: number;
  lastRedemption?: LoyaltyRedemption;
  error?: string;
};

const initialState = (member: LoyaltyMemberSummary): RedemptionFormState => ({
  optimisticBalance: member.availablePoints,
  optimisticOnHold: member.pointsOnHold,
  lastRedemption: undefined,
  error: undefined
});

export function LoyaltyHubClient({ member, rewards }: LoyaltyHubClientProps) {
  const [isRedeeming, startRedeem] = useTransition();
  const [state, setState] = useState<RedemptionFormState>(() => initialState(member));

  const sortedRewards = useMemo(
    () => rewards.filter((reward) => reward.isActive).sort((a, b) => a.costPoints - b.costPoints),
    [rewards]
  );

  const progressPercentage = Math.min(Math.round(member.progressToNextTier * 100), 100);

  const nextTierCopy = member.nextTier
    ? `Only ${POINTS_DISPLAY.format(Math.max(state.optimisticOnHold + state.optimisticBalance, 0))} pts away from ${member.nextTier}.`
    : "You&rsquo;ve reached the highest tier available.";

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
      error: undefined
    }));

    startRedeem(async () => {
      try {
        const redemption = await requestRedemption({ rewardSlug: reward.slug, quantity: 1 });
        setState((previous) => ({
          optimisticBalance: previous.optimisticBalance,
          optimisticOnHold: previous.optimisticOnHold,
          lastRedemption: redemption,
          error: undefined
        }));
      } catch (error) {
        setState({
          optimisticBalance: member.availablePoints,
          optimisticOnHold: member.pointsOnHold,
          lastRedemption: undefined,
          error: error instanceof Error ? error.message : "Unable to create redemption"
        });
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

      <section className="grid gap-6 md:grid-cols-2">
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
      </section>

      <section className="space-y-6">
        <header>
          <h3 className="text-xl font-semibold">Rewards catalog</h3>
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
