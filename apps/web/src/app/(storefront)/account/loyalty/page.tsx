import type { Metadata } from "next";

import { auth } from "@/server/auth";
import {
  allowAuthBypass,
  buildBypassMember,
  buildBypassRewards,
  fetchLoyaltyMember,
  fetchLoyaltyRewards
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
      return <LoyaltyHubClient member={buildBypassMember()} rewards={buildBypassRewards()} />;
    }

    throw new Error("Loyalty hub requires an authenticated user.");
  }

  const [member, rewards] = await Promise.all([
    fetchLoyaltyMember(session.user.id),
    fetchLoyaltyRewards()
  ]);

  return <LoyaltyHubClient member={member} rewards={rewards} />;
}
