"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";

import { useCartStore } from "@/store/cart";

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

const baseNavLinks = [
  { href: "/products", label: "Products" },
  { href: "/trust-preview", label: "Trust preview" },
];

export function Header() {
  const itemCount = useCartStore((state) => state.items.reduce((acc, item) => acc + item.quantity, 0));
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const isOperator = role === "ADMIN" || role === "FINANCE";
  const isCustomer = role === "CLIENT";

  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-black/60 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4 text-sm text-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-6">
          <Link href="/" className="text-xl font-semibold text-white">
            SMPLAT
          </Link>
          <div className="flex items-center gap-4 sm:hidden">
            {renderAccountLinks({ isOperator, isCustomer, status })}
            {renderAuthButton(status)}
            {renderSignOutButton(Boolean(session))}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex flex-wrap items-center gap-4 text-white/70">
            {baseNavLinks.map((link) => (
              <Link key={link.href} href={link.href} className="transition hover:text-white">
                {link.label}
              </Link>
            ))}
            {renderAccountLinks({ isOperator, isCustomer, status })}
            <Link
              href="/cart"
              className="flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-white/80 transition hover:border-white/50 hover:text-white"
              data-testid="cart-link"
            >
              <span>Cart</span>
              {itemCount > 0 ? (
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-black" data-testid="cart-count">
                  {itemCount}
                </span>
              ) : null}
            </Link>
          </div>
          <div className="hidden items-center gap-4 sm:flex">
            {renderAccountLinks({ isOperator, isCustomer, status })}
            {renderAuthButton(status)}
            {renderSignOutButton(Boolean(session))}
          </div>
        </div>
      </nav>
    </header>
  );
}

function renderAccountLinks({
  isOperator,
  isCustomer,
  status,
}: {
  isOperator: boolean;
  isCustomer: boolean;
  status: AuthStatus;
}) {
  if (status === "loading") {
    return null;
  }
  const links: { href: string; label: string }[] = [];
  if (isCustomer || isOperator) {
    links.push({ href: "/account", label: "Account" });
  }
  if (isOperator) {
    links.push({ href: "/admin/orders", label: "Admin" });
  }
  return links.map((link) => (
    <Link key={link.href} href={link.href} className="transition hover:text-white">
      {link.label}
    </Link>
  ));
}

function renderAuthButton(status: AuthStatus) {
  if (status === "authenticated") {
    return null;
  }
  return (
    <Link href="/login" className="rounded-full border border-white/30 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-white/80 transition hover:border-white/60 hover:text-white">
      Sign in
    </Link>
  );
}

function renderSignOutButton(isAuthenticated: boolean) {
  if (!isAuthenticated) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-full border border-white/30 px-4 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-white/70 transition hover:border-white/60 hover:text-white"
    >
      Sign out
    </button>
  );
}
