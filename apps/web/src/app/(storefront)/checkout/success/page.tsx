"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { useCartStore } from "@/store/cart";

export default function CheckoutSuccessPage() {
  const searchParams = useSearchParams();
  const clear = useCartStore((state) => state.clear);
  const orderId = searchParams.get("order");

  useEffect(() => {
    clear();
  }, [clear]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-20 text-white">
      <section className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur">
        <h1 className="text-3xl font-semibold">Payment successful 🎉</h1>
        <p className="mt-4 text-white/70">
          Thank you for partnering with SMPLAT. Your campaign pod will be in touch within one business day with next
          steps.
        </p>
        {orderId ? (
          <p className="mt-2 text-sm text-white/50">Order reference: {orderId}</p>
        ) : null}
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            View client portal
          </Link>
          <Link
            href="/products"
            className="inline-flex items-center rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
          >
            Browse more services
          </Link>
        </div>
      </section>
    </main>
  );
}
