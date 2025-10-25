"use client";

import Link from "next/link";
import { useCartStore, cartTotalSelector } from "@/store/cart";

export function Header() {
  const itemCount = useCartStore((state) => state.items.reduce((acc, item) => acc + item.quantity, 0));
  const total = useCartStore(cartTotalSelector);

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/50 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-xl font-semibold text-white">
          SMPLAT
        </Link>

        <div className="flex items-center gap-6">
          <Link href="/products" className="text-sm text-white/70 hover:text-white transition">
            Services
          </Link>

          <Link href="/cart" className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition" data-testid="cart-link">
            <span>Cart</span>
            {itemCount > 0 && (
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-black" data-testid="cart-count">
                {itemCount}
              </span>
            )}
          </Link>

          <Link href="/login" className="text-sm text-white/70 hover:text-white transition">
            Sign in
          </Link>
        </div>
      </nav>
    </header>
  );
}
