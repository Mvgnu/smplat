import type { Metadata } from "next";

import { requireRole } from "@/server/auth/policies";
import { getOrCreateCsrfToken } from "@/server/security/csrf";
import {
  allowAuthBypass,
  buildBypassConversions,
  buildBypassLedgerPage,
  buildBypassMember,
  buildBypassNextActions,
  buildBypassNudges,
  buildBypassRedemptions,
  buildBypassRewards,
  fetchLoyaltyLedger,
  fetchLoyaltyMember,
  fetchLoyaltyNudges,
  fetchLoyaltyRedemptions,
  fetchLoyaltyRewards,
  fetchReferralConversions
} from "./data";
import { fetchCheckoutNextActions } from "@/server/loyalty/intents";
import {
  configureLoyaltyTimelineFetchers,
  fetchLoyaltyTimeline,
  resetLoyaltyTimelineFetchers
} from "@/server/loyalty/timeline";
import { buildBypassGuardrailSnapshot } from "@/server/loyalty/guardrails";
import { LoyaltyHubClient } from "./loyalty.client";

export const metadata: Metadata = {
  title: "Loyalty hub",
  description: "Review tier progress, point balances, and redeem rewards."
};

export default async function LoyaltyHubPage() {
  const { session } = await requireRole("member", {
    context: {
      route: "storefront.account.loyalty.page",
      method: "GET"
    }
  });
  const csrfToken = getOrCreateCsrfToken();

  if (allowAuthBypass()) {
    configureLoyaltyTimelineFetchers({
      fetchLoyaltyLedger: async () => buildBypassLedgerPage(),
      fetchLoyaltyRedemptions: async () => buildBypassRedemptions(),
      fetchReferralConversions: async () => buildBypassConversions(),
      fetchLoyaltyNudgeHistory: async () => buildBypassNudges(),
      fetchGuardrailSnapshot: async () => buildBypassGuardrailSnapshot()
    });
    let timeline;
    try {
      timeline = await fetchLoyaltyTimeline({ limit: 20 });
    } finally {
      resetLoyaltyTimelineFetchers();
    }
    return (
      <LoyaltyHubClient
        ledger={buildBypassLedgerPage()}
        member={buildBypassMember()}
        redemptions={buildBypassRedemptions()}
        referrals={buildBypassConversions()}
        rewards={buildBypassRewards()}
        nextActions={buildBypassNextActions()}
        nudges={buildBypassNudges()}
        timeline={timeline}
        csrfToken={csrfToken}
      />
    );
  }

  const userId = session.user?.id;
  if (!userId) {
    throw new Error("Loyalty hub requires an authenticated user.");
  }

  const [member, rewards, ledger, redemptions, referrals, nextActions, nudges, timeline] =
    await Promise.all([
      fetchLoyaltyMember(userId),
      fetchLoyaltyRewards(),
      fetchLoyaltyLedger(),
      fetchLoyaltyRedemptions(),
      fetchReferralConversions({ statuses: ["converted", "sent", "cancelled", "expired"] }),
      fetchCheckoutNextActions(userId),
      fetchLoyaltyNudges(),
      fetchLoyaltyTimeline({ limit: 20 })
    ]);

  return (
    <LoyaltyHubClient
      ledger={ledger}
      member={member}
      redemptions={redemptions}
      referrals={referrals}
      rewards={rewards}
      nextActions={nextActions}
      nudges={nudges}
      timeline={timeline}
      csrfToken={csrfToken}
    />
  );
}
