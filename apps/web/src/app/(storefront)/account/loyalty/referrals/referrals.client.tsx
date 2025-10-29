"use client";

import { useMemo, useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";

import type { LoyaltyMemberSummary, ReferralInviteResponse } from "@smplat/types";

import { cancelReferralInvite, issueReferralInvite } from "../loyalty.actions";

type ReferralHubClientProps = {
  member: LoyaltyMemberSummary;
  referrals: ReferralInviteResponse[];
  shareBaseUrl: string;
};

type FormState = {
  email: string;
  error?: string;
  notice?: string;
};

type ReferralListState = {
  items: ReferralInviteResponse[];
};

const INITIAL_FORM_STATE: FormState = {
  email: "",
  error: undefined,
  notice: undefined
};

export function ReferralHubClient({ member, referrals, shareBaseUrl }: ReferralHubClientProps) {
  const [isPending, startTransition] = useTransition();
  const [formState, setFormState] = useState<FormState>(INITIAL_FORM_STATE);
  const [listState, setListState] = useState<ReferralListState>({ items: referrals });

  const activeCount = useMemo(
    () => listState.items.filter((item) => item.status === "draft" || item.status === "sent").length,
    [listState.items]
  );

  const normalizedBase = useMemo(() => shareBaseUrl.replace(/\/$/, ""), [shareBaseUrl]);

  const resetNotice = () => setFormState((previous) => ({ ...previous, error: undefined, notice: undefined }));

  const handleCreate = () => {
    if (isPending) {
      return;
    }

    startTransition(async () => {
      try {
        const referral = await issueReferralInvite({
          inviteeEmail: formState.email ? formState.email.trim() : undefined
        });
        setListState((previous) => ({ items: [referral, ...previous.items] }));
        setFormState({ email: "", notice: "Referral invite created.", error: undefined });
      } catch (error) {
        setFormState((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : "Unable to create referral",
          notice: undefined
        }));
      }
    });
  };

  const handleCancel = (referralId: string) => {
    if (isPending) {
      return;
    }

    startTransition(async () => {
      try {
        const updated = await cancelReferralInvite(referralId);
        setListState((previous) => ({
          items: previous.items.map((item) => (item.id === updated.id ? updated : item))
        }));
        setFormState((previous) => ({ ...previous, notice: "Referral invite cancelled.", error: undefined }));
      } catch (error) {
        setFormState((previous) => ({
          ...previous,
          error: error instanceof Error ? error.message : "Unable to cancel referral",
          notice: undefined
        }));
      }
    });
  };

  const renderStatusLabel = (referral: ReferralInviteResponse) => {
    if (referral.status === "converted" && referral.completedAt) {
      return `Converted ${formatDistanceToNow(new Date(referral.completedAt), { addSuffix: true })}`;
    }
    if (referral.status === "cancelled") {
      return "Cancelled";
    }
    if (referral.status === "expired") {
      return "Expired";
    }
    return "Awaiting conversion";
  };

  const handleCopyLink = async (code: string) => {
    const link = `${normalizedBase}/?ref=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setFormState((previous) => ({ ...previous, notice: "Referral link copied.", error: undefined }));
    } catch (error) {
      setFormState((previous) => ({
        ...previous,
        error: error instanceof Error ? error.message : "Unable to copy referral link",
        notice: undefined
      }));
    }
  };

  return (
    <div className="space-y-12" data-testid="referral-hub">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/30">
        <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-white/50">Referral program</p>
            <h2 className="text-2xl font-semibold">Invite partners & friends</h2>
            <p className="text-sm text-white/60">
              Share your code to earn bonus loyalty rewards whenever an invite becomes a paying member.
            </p>
          </div>
          {member.referralCode ? (
            <div className="flex flex-col items-start gap-2 md:items-end">
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Your referral code</p>
              <div className="flex items-center gap-2 rounded-full border border-white/20 bg-black/30 px-4 py-2 text-sm">
                <span className="font-semibold">{member.referralCode}</span>
                <button
                  className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                  onClick={() => handleCopyLink(member.referralCode!)}
                  type="button"
                >
                  Copy
                </button>
              </div>
            </div>
          ) : null}
        </header>
        <div className="mt-8 space-y-4" data-testid="referral-form">
          <label className="block text-sm text-white/70">
            Invitee email (optional)
            <input
              className="mt-2 w-full rounded-full border border-white/20 bg-black/30 px-4 py-2 text-sm text-white placeholder-white/40 focus:border-white/60 focus:outline-none"
              onChange={(event) => setFormState((previous) => ({ ...previous, email: event.target.value }))}
              onFocus={resetNotice}
              placeholder="friend@example.com"
              type="email"
              value={formState.email}
            />
          </label>
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>{activeCount} active invites</span>
            <button
              className="rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-black transition hover:bg-white/80 disabled:cursor-not-allowed disabled:bg-white/40"
              disabled={isPending}
              onClick={handleCreate}
              type="button"
            >
              {isPending ? "Sending" : "Send invite"}
            </button>
          </div>
          {formState.error ? (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100" data-testid="referral-error">
              {formState.error}
            </p>
          ) : null}
          {formState.notice ? (
            <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" data-testid="referral-success">
              {formState.notice}
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h3 className="text-xl font-semibold">Referral history</h3>
            <p className="text-sm text-white/60">Track invites, conversions, and cancellations in one place.</p>
          </div>
        </header>
        {listState.items.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/60">
            No referral invites sent yet. Start by sharing your code above.
          </p>
        ) : (
          <ul className="space-y-4">
            {listState.items.map((referral) => {
              const shareLink = `${normalizedBase}/?ref=${referral.code}`;
              return (
                <li
                  key={referral.id}
                  className="rounded-2xl border border-white/10 bg-white/5 p-6"
                  data-testid="referral-item"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1 text-sm">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/50">Invite code</p>
                      <p className="font-semibold text-white">{referral.code}</p>
                      <p className="text-white/60">
                        Sent {formatDistanceToNow(new Date(referral.createdAt), { addSuffix: true })}
                      </p>
                      <p className="text-white/60">{renderStatusLabel(referral)}</p>
                    </div>
                    <div className="flex flex-col gap-2 text-sm">
                      <button
                        className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/40 hover:text-white"
                        onClick={() => handleCopyLink(referral.code)}
                        type="button"
                      >
                        Copy link
                      </button>
                      {referral.status === "sent" || referral.status === "draft" ? (
                        <button
                          className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-red-300 hover:text-red-200"
                          data-testid="referral-cancel"
                          onClick={() => handleCancel(referral.id)}
                          type="button"
                        >
                          Cancel invite
                        </button>
                      ) : null}
                      <span className="text-xs text-white/40">Share: {shareLink}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
