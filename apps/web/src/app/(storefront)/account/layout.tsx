import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/server/auth";

const navigation = [
  { href: "/account/loyalty", label: "Loyalty" },
  { href: "/account/loyalty/referrals", label: "Referrals" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/settings", label: "Settings" }
];

type AccountLayoutProps = {
  children: ReactNode;
};

const allowBypass = process.env.NEXT_PUBLIC_E2E_AUTH_BYPASS === "true";

export default async function AccountLayout({ children }: AccountLayoutProps) {
  const session = await auth();
  if (!session?.user?.id && !allowBypass) {
    redirect("/login?next=/account/loyalty");
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-12 px-6 py-16 text-white">
      <header className="space-y-2">
        <p className="uppercase tracking-[0.3em] text-xs text-white/50">Member</p>
        <h1 className="text-3xl font-semibold">Account</h1>
        <p className="text-white/60">Track your loyalty journey and manage rewards in one place.</p>
      </header>

      <nav className="flex flex-wrap gap-3 text-sm text-white/70">
        {navigation.map((item) => (
          <Link
            key={item.href}
            className="rounded-full border border-white/10 px-4 py-1.5 transition hover:border-white/40 hover:text-white"
            href={item.href}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <main className="flex-1 pb-24">{children}</main>
    </div>
  );
}
