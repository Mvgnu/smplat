import type { Metadata } from "next";

import { auth } from "@/server/auth";
import {
  allowAuthBypass,
  buildBypassConversions,
  buildBypassLedgerPage,
  buildBypassMember,
  buildBypassRedemptions,
  buildBypassRewards,
  fetchLoyaltyLedger,
  fetchLoyaltyMember,
  fetchLoyaltyRedemptions,
  fetchLoyaltyRewards,
  fetchReferralConversions
} from "./data";
import { LoyaltyHubClient } from "./loyalty.client";

export const metadata: Metadata = {
  title: "Loyalty hub",
  description: "Review tier progress, point balances, and redeem rewards."
};

export default async function LoyaltyHubPage() {
  const session = await auth();

  if (!session?.user?.id) {
    if (allowAuthBypass()) {
      return (
        <LoyaltyHubClient
          ledger={buildBypassLedgerPage()}
          member={buildBypassMember()}
          redemptions={buildBypassRedemptions()}
          referrals={buildBypassConversions()}
          rewards={buildBypassRewards()}
        />
      );
    }

    throw new Error("Loyalty hub requires an authenticated user.");
  }

  const [member, rewards, ledger, redemptions, referrals] = await Promise.all([
    fetchLoyaltyMember(session.user.id),
    fetchLoyaltyRewards(),
    fetchLoyaltyLedger(),
    fetchLoyaltyRedemptions(),
    fetchReferralConversions({ statuses: ["converted", "sent", "cancelled", "expired"] })
  ]);

  return (
    <LoyaltyHubClient
      ledger={ledger}
      member={member}
      redemptions={redemptions}
      referrals={referrals}
      rewards={rewards}
    />
  );
}
