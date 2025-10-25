import type { Metadata } from "next";

import { CheckoutPageClient } from "./checkout.client";

export const metadata: Metadata = {
  title: "Checkout | SMPLAT",
  description: "Complete your SMPLAT service purchase securely."
};

export default function CheckoutPage() {
  return <CheckoutPageClient />;
}
