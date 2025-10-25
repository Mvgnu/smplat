import type { Metadata } from "next";

import { CartPageClient } from "./cart.client";

export const metadata: Metadata = {
  title: "Cart | SMPLAT",
  description: "Review your selected social media campaigns before checkout."
};

export default function CartPage() {
  return <CartPageClient />;
}
