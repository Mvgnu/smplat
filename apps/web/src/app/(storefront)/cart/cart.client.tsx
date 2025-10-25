"use client";

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

export function CartPageClient() {
  const items = useCartStore((state) => state.items);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clear = useCartStore((state) => state.clear);
  const total = useCartStore(cartTotalSelector);

  if (items.length === 0) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-24 text-white" data-testid="empty-cart">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-12 text-center backdrop-blur">
          <h1 className="text-3xl font-semibold">Your cart is empty</h1>
          <p className="mt-4 text-white/70">Browse our services and configure a package to get started.</p>
          <div className="mt-8">
            <Link
              href="/products"
              className="inline-flex items-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
              data-testid="explore-services"
            >
              Explore services
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const currency = items[0].currency;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16 text-white" data-testid="cart-page">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Review your campaign bundle</h1>
        <p className="text-sm text-white/60">
          Fine-tune quantities, requirements, and proceed to checkout to confirm payment.
        </p>
      </header>

      <div className="space-y-6">
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur transition hover:border-white/20"
            data-testid="cart-item"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">{item.title}</h2>
                <p className="text-sm text-white/60">Base price {formatCurrency(item.basePrice, item.currency)}</p>
                <p className="text-sm text-white/60">Configuration total {formatCurrency(item.unitPrice, item.currency)}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center rounded-full border border-white/15">
                  <button
                    type="button"
                    className="px-3 py-2 text-sm text-white/70 transition hover:text-white"
                    onClick={() => updateQuantity(item.id, Math.max(1, item.quantity - 1))}
                    data-testid="quantity-decrease"
                  >
                    −
                  </button>
                  <span className="px-4 py-2 text-sm font-semibold text-white" data-testid="quantity-display">{item.quantity}</span>
                  <button
                    type="button"
                    className="px-3 py-2 text-sm text-white/70 transition hover:text-white"
                    onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    data-testid="quantity-increase"
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="text-xs font-semibold uppercase tracking-wide text-white/50 transition hover:text-red-300"
                  data-testid="remove-item"
                >
                  Remove
                </button>
              </div>
            </div>

            {item.selectedOptions.length > 0 ? (
              <div className="mt-4 space-y-2 text-sm text-white/70">
                <p className="text-xs uppercase tracking-wide text-white/40">Selected options</p>
                <ul className="space-y-1">
                  {item.selectedOptions.map((selection) => (
                    <li key={`${selection.groupId}-${selection.optionId}`}>
                      <span className="text-white/60">{selection.groupName}:</span> {selection.label}{" "}
                      {selection.priceDelta !== 0
                        ? `(${selection.priceDelta > 0 ? "+" : "-"}${formatCurrency(
                            Math.abs(selection.priceDelta),
                            item.currency
                          )})`
                        : "(included)"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {item.addOns.length > 0 ? (
              <div className="mt-4 space-y-2 text-sm text-white/70">
                <p className="text-xs uppercase tracking-wide text-white/40">Add-ons</p>
                <ul className="space-y-1">
                  {item.addOns.map((addOn) => (
                    <li key={addOn.id}>
                      {addOn.label} (+{formatCurrency(addOn.priceDelta, item.currency)})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {item.subscriptionPlan ? (
              <div className="mt-4 text-sm text-white/70">
                <p className="text-xs uppercase tracking-wide text-white/40">Subscription</p>
                <p>
                  {item.subscriptionPlan.label} ({item.subscriptionPlan.billingCycle.replace("_", " ")})
                </p>
              </div>
            ) : null}

            {item.customFields.length > 0 ? (
              <div className="mt-4 space-y-2 text-sm text-white/70">
                <p className="text-xs uppercase tracking-wide text-white/40">Fulfillment inputs</p>
                <ul className="space-y-1">
                  {item.customFields.map((field) => (
                    <li key={field.id}>
                      <span className="text-white/60">{field.label}:</span> {field.value || "Not provided"}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-4 text-sm text-white/70">
              <span>Line total</span>
              <span className="text-lg font-semibold text-white">
                {formatCurrency(item.unitPrice * item.quantity, item.currency)}
              </span>
            </div>
          </article>
        ))}
      </div>

      <aside className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-6 text-white backdrop-blur">
        <div className="flex items-center justify-between text-sm">
          <span className="uppercase tracking-wide text-white/40">Subtotal</span>
          <span className="text-xl font-semibold">{formatCurrency(total, currency)}</span>
        </div>
        <p className="text-xs text-white/60">
          Taxes and payment processing fees are calculated during checkout. Campaign milestones and analytics access are
          available immediately after payment.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/checkout"
            className="inline-flex flex-1 items-center justify-center rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
            data-testid="checkout-button"
          >
            Proceed to checkout
          </Link>
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center justify-center rounded-full border border-white/30 px-6 py-3 text-sm font-semibold text-white transition hover:border-white/60"
            data-testid="clear-cart"
          >
            Clear cart
          </button>
        </div>
      </aside>
    </main>
  );
}
