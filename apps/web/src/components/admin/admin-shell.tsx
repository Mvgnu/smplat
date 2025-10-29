"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// meta: component: AdminShell
// meta: owner: platform

export type AdminNavItem = {
  href: string;
  label: string;
  description: string;
  icon?: ReactNode;
};

export type AdminShellProps = {
  navItems: AdminNavItem[];
  title: string;
  subtitle?: string;
  children: ReactNode;
  sidebarFooter?: ReactNode;
  topRightSlot?: ReactNode;
};

export function AdminShell({
  navItems,
  title,
  subtitle,
  children,
  sidebarFooter,
  topRightSlot
}: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[#05070B] text-white">
      <aside className="hidden w-72 flex-col justify-between border-r border-white/10 bg-black/40 px-6 py-8 backdrop-blur lg:flex">
        <div className="space-y-8">
          <Link href="/admin" className="flex items-center gap-3 text-white">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-lg font-bold">
              sm
            </span>
            <div className="leading-tight">
              <p className="text-sm uppercase tracking-[0.4em] text-white/40">Operator</p>
              <p className="text-lg font-semibold">Control Hub</p>
            </div>
          </Link>

          <nav className="space-y-2">
            {navItems.map((item) => {
              const isActive = pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded-2xl border px-4 py-3 transition ${
                    isActive
                      ? "border-white/20 bg-white/10 text-white"
                      : "border-transparent bg-transparent text-white/70 hover:border-white/10 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="flex items-center justify-between text-sm font-medium">
                    <span>{item.label}</span>
                    {item.icon}
                  </div>
                  <p className="mt-2 text-xs text-white/40">{item.description}</p>
                </Link>
              );
            })}
          </nav>
        </div>

        {sidebarFooter && <div className="border-t border-white/5 pt-6 text-xs text-white/40">{sidebarFooter}</div>}
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-start justify-between gap-6 border-b border-white/10 bg-black/30 px-6 py-6 backdrop-blur">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-white/40">Admin workspace</p>
            <h1 className="mt-1 text-2xl font-semibold text-white">{title}</h1>
            {subtitle ? <p className="mt-2 max-w-2xl text-sm text-white/60">{subtitle}</p> : null}
          </div>
          <div className="flex w-full max-w-md items-center gap-3 self-center rounded-2xl border border-white/10 bg-black/50 p-3 text-sm text-white/50 sm:self-start">
            <span className="hidden text-white/40 sm:inline">⌘K</span>
            <span className="flex-1">Search across orders, loyalty, merchandising...</span>
          </div>
          {topRightSlot ? <div className="hidden sm:block">{topRightSlot}</div> : null}
        </header>

        <main className="flex-1 bg-[#05070B] px-4 pb-12 pt-8 sm:px-6 lg:px-10">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
