import type { Metadata } from "next";

import { fetchMemberReferrals } from "@/lib/loyalty/referrals";
import { requireRole } from "@/server/auth/policies";
import { getOrCreateCsrfToken } from "@/server/security/csrf";

import { ReferralHubClient } from "./referrals.client";
import {
  allowAuthBypass,
  buildBypassMember,
  buildBypassSegmentsSnapshot,
  buildBypassVelocityTimeline,
  fetchLoyaltyMember,
  fetchLoyaltySegmentsSnapshot,
  fetchLoyaltyVelocityTimeline
} from "../data";

const shareBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const bypassUserId = "00000000-0000-0000-0000-000000000001";

export const metadata: Metadata = {
  title: "Referral invites",
  description: "Send invites, share referral links, and monitor conversions."
};

export default async function LoyaltyReferralsPage() {
  const { session } = await requireRole("member", {
    context: {
      route: "storefront.account.loyalty.referrals.page",
      method: "GET"
    }
  });
  const csrfToken = getOrCreateCsrfToken();

  if (allowAuthBypass()) {
    const [member, referrals, segments, velocity] = await Promise.all([
      Promise.resolve(buildBypassMember()),
      fetchMemberReferrals(bypassUserId),
      Promise.resolve(buildBypassSegmentsSnapshot()),
      Promise.resolve(buildBypassVelocityTimeline())
    ]);
    return (
      <ReferralHubClient
        member={member}
        referrals={referrals}
        shareBaseUrl={shareBaseUrl}
        csrfToken={csrfToken}
        segmentsSnapshot={segments}
        velocityTimeline={velocity}
      />
    );
  }

  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Referral hub requires an authenticated user.");
  }

  const [member, referrals, segments, velocity] = await Promise.all([
    fetchLoyaltyMember(userId),
    fetchMemberReferrals(userId),
    fetchLoyaltySegmentsSnapshot(),
    fetchLoyaltyVelocityTimeline({ limit: 12 })
  ]);

  return (
    <ReferralHubClient
      member={member}
      referrals={referrals}
      shareBaseUrl={shareBaseUrl}
      csrfToken={csrfToken}
      segmentsSnapshot={segments}
      velocityTimeline={velocity}
    />
  );
}
