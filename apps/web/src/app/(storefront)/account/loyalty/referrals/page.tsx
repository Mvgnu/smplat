import type { Metadata } from "next";

import { fetchMemberReferrals } from "@/lib/loyalty/referrals";
import { requireRole } from "@/server/auth/policies";
import { getOrCreateCsrfToken } from "@/server/security/csrf";

import { ReferralHubClient } from "./referrals.client";
import {
  allowAuthBypass,
  buildBypassMember,
  fetchLoyaltyMember
} from "../data";

const shareBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const bypassUserId = "00000000-0000-0000-0000-000000000001";

export const metadata: Metadata = {
  title: "Referral invites",
  description: "Send invites, share referral links, and monitor conversions."
};

export default async function LoyaltyReferralsPage() {
  const { session } = await requireRole("member");
  const csrfToken = getOrCreateCsrfToken();

  if (allowAuthBypass()) {
    const [member, referrals] = await Promise.all([
      Promise.resolve(buildBypassMember()),
      fetchMemberReferrals(bypassUserId)
    ]);
    return (
      <ReferralHubClient
        member={member}
        referrals={referrals}
        shareBaseUrl={shareBaseUrl}
        csrfToken={csrfToken}
      />
    );
  }

  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Referral hub requires an authenticated user.");
  }

  const [member, referrals] = await Promise.all([
    fetchLoyaltyMember(userId),
    fetchMemberReferrals(userId)
  ]);

  return (
    <ReferralHubClient
      member={member}
      referrals={referrals}
      shareBaseUrl={shareBaseUrl}
      csrfToken={csrfToken}
    />
  );
}
