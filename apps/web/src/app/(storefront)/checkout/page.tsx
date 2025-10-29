import type { Metadata } from "next";

import { getCheckoutTrustExperience } from "@/server/cms/trust";
import { auth } from "@/server/auth";
import {
  allowAuthBypass,
  buildBypassMember,
  buildBypassRewards,
  fetchLoyaltyMember,
  fetchLoyaltyRewards
} from "../account/loyalty/data";

import { CheckoutPageClient } from "./checkout.client";

export const metadata: Metadata = {
  title: "Checkout | SMPLAT",
  description: "Complete your SMPLAT service purchase securely."
};

export default async function CheckoutPage() {
  const trustExperience = await getCheckoutTrustExperience();
  const session = await auth();

  if (!session?.user?.id) {
    if (allowAuthBypass()) {
      return (
        <CheckoutPageClient
          trustContent={trustExperience}
          loyaltyMember={buildBypassMember()}
          loyaltyRewards={buildBypassRewards()}
        />
      );
    }

    return <CheckoutPageClient trustContent={trustExperience} loyaltyMember={null} loyaltyRewards={[]} />;
  }

  const [loyaltyMember, loyaltyRewards] = await Promise.all([
    fetchLoyaltyMember(session.user.id),
    fetchLoyaltyRewards()
  ]);

  return (
    <CheckoutPageClient
      trustContent={trustExperience}
      loyaltyMember={loyaltyMember}
      loyaltyRewards={loyaltyRewards}
    />
  );
}
