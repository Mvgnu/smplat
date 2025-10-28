import type { Metadata } from "next";

import { getCheckoutTrustExperience } from "@/server/cms/trust";

import { CheckoutPageClient } from "./checkout.client";

export const metadata: Metadata = {
  title: "Checkout | SMPLAT",
  description: "Complete your SMPLAT service purchase securely."
};

export default async function CheckoutPage() {
  const trustExperience = await getCheckoutTrustExperience();

  return <CheckoutPageClient trustContent={trustExperience} />;
}
