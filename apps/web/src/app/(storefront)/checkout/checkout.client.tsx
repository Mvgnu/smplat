"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";

import { cartTotalSelector, useCartStore } from "@/store/cart";

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

type CheckoutState = {
  fullName: string;
  email: string;
  company?: string;
  notes?: string;
};

export function CheckoutPageClient() {
  const items = useCartStore((state) => state.items);
  const cartTotal = useCartStore(cartTotalSelector);
  const clearCart = useCartStore((state) => state.clear);

  const [formState, setFormState] = useState<CheckoutState>({
    fullName: "",
    email: "",
    company: "",
    notes: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = items[0]?.currency ?? "USD";

  const disabled = items.length === 0 || !formState.fullName || !formState.email;

  const orderSummary = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.unitPrice * item.quantity
      })),
    [items]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (disabled) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";

      const payload = {
        order: {
          currency,
          source: "checkout",
          notes: `Customer: ${formState.fullName} (${formState.email})${formState.company ? ` | Company: ${formState.company}` : ""}${
            formState.notes ? ` | Notes: ${formState.notes}` : ""
          }`,
          items: items.map((item) => ({
            product_id: item.productId,
            product_title: item.title,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.unitPrice * item.quantity,
            selected_options: {
              options: item.selectedOptions,
              addOns: item.addOns,
              subscriptionPlan: item.subscriptionPlan
            },
            attributes: {
              customFields: item.customFields
            }
          }))
        },
        payment: {
          customer_email: formState.email,
          success_url: `${origin}/checkout/success`,
          cancel_url: `${origin}/checkout`
        }
      };

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error ?? "Checkout request failed");
      }

      const { payment, order } = await response.json();
      const checkoutUrl = payment.checkout_url;

      // Defer clearing the cart until success callback.
      window.location.href = `${checkoutUrl}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected checkout error";
      setError(message);
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-24 text-white">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-12 text-center backdrop-blur">
          <h1 className="text-3xl font-semibold">Your cart is empty</h1>
          <p className="mt-4 text-white/70">Add a service configuration before checking out.</p>
          <div className="mt-8">
            <Link
              href="/products"
              className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              Browse services
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-16 text-white">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">Checkout</h1>
        <p className="text-sm text-white/60">
          Confirm your contact details and finalize payment via our Stripe-hosted checkout.
        </p>
      </header>

      <section className="grid gap-10 lg:grid-cols-[3fr,2fr]">
        <form onSubmit={handleSubmit} className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <div>
            <h2 className="text-xl font-semibold text-white">Contact details</h2>
            <p className="text-sm text-white/60">We use this information to send campaign updates and invoices.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-white/80">
              Full name
              <input
                type="text"
                value={formState.fullName}
                onChange={(event) => setFormState((prev) => ({ ...prev, fullName: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white outline-none transition focus:border-white/40"
                required
                data-testid="name-input"
              />
            </label>
            <label className="space-y-2 text-sm text-white/80">
              Email
              <input
                type="email"
                value={formState.email}
                onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white outline-none transition focus:border-white/40"
                required
                data-testid="email-input"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-white/80">
              Company (optional)
              <input
                type="text"
                value={formState.company}
                onChange={(event) => setFormState((prev) => ({ ...prev, company: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white outline-none transition focus:border-white/40"
                data-testid="company-input"
              />
            </label>
            <label className="space-y-2 text-sm text-white/80">
              Notes (optional)
              <input
                type="text"
                value={formState.notes}
                onChange={(event) => setFormState((prev) => ({ ...prev, notes: event.target.value }))}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-white outline-none transition focus:border-white/40"
                placeholder="Any specifics for onboarding?"
              />
            </label>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isSubmitting || disabled}
              className="inline-flex flex-1 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="submit-checkout"
            >
              {isSubmitting ? "Redirecting to Stripe…" : "Secure checkout"}
            </button>
            <button
              type="button"
              onClick={() => {
                clearCart();
                setFormState({ fullName: "", email: "", company: "", notes: "" });
              }}
              className="inline-flex items-center justify-center rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
            >
              Clear cart
            </button>
          </div>
        </form>

        <aside className="space-y-6 rounded-3xl border border-white/10 bg-white/5 p-6 text-white backdrop-blur">
          <div>
            <h2 className="text-lg font-semibold text-white">Order summary</h2>
            <p className="text-sm text-white/60">
              {items.length} {items.length === 1 ? "service" : "services"} configured
            </p>
          </div>
          <div className="space-y-4 text-sm text-white/70">
            {orderSummary.map((line) => (
              <div key={line.id} className="border-b border-white/10 pb-4">
                <p className="font-semibold text-white">{line.title}</p>
                <p>
                  {line.quantity} × {formatCurrency(line.unitPrice, currency)}
                </p>
                <p className="text-white/50">
                  Line total {formatCurrency(line.totalPrice, currency)}
                </p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-white/10 pt-4 text-sm">
            <span className="uppercase tracking-wide text-white/40">Subtotal</span>
            <span className="text-xl font-semibold text-white">{formatCurrency(cartTotal, currency)}</span>
          </div>
          <p className="text-xs text-white/60">
            Payments are processed securely via Stripe. You&apos;ll be redirected to confirm card details. On success
            we&apos;ll follow up with onboarding steps and assign your fulfillment pod.
          </p>
        </aside>
      </section>
    </main>
  );
}
