import type { Metadata } from "next";

import { fetchMemberReferrals } from "@/lib/loyalty/referrals";
import { auth } from "@/server/auth";

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
  const session = await auth();

  if (!session?.user?.id) {
    if (allowAuthBypass()) {
      const [member, referrals] = await Promise.all([
        Promise.resolve(buildBypassMember()),
        fetchMemberReferrals(bypassUserId)
      ]);
      return <ReferralHubClient member={member} referrals={referrals} shareBaseUrl={shareBaseUrl} />;
    }

    throw new Error("Referral hub requires an authenticated user.");
  }

  const [member, referrals] = await Promise.all([
    fetchLoyaltyMember(session.user.id),
    fetchMemberReferrals(session.user.id)
  ]);

  return <ReferralHubClient member={member} referrals={referrals} shareBaseUrl={shareBaseUrl} />;
}
