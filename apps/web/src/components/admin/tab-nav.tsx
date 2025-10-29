"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// meta: component: AdminTabNav
// meta: owner: platform

export type AdminTab = {
  label: string;
  href: string;
  badge?: string;
};

export type AdminTabNavProps = {
  tabs: AdminTab[];
  size?: "sm" | "md";
};

export function AdminTabNav({ tabs, size = "md" }: AdminTabNavProps) {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        const baseClasses =
          size === "sm"
            ? "rounded-full px-3 py-1.5 text-xs"
            : "rounded-full px-4 py-2 text-sm";

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`${baseClasses} border transition ${
              isActive
                ? "border-white/30 bg-white/10 text-white shadow-[0_0_18px_rgba(255,255,255,0.12)]"
                : "border-white/10 bg-white/5 text-white/60 hover:border-white/30 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.badge ? (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[0.65rem] text-white/70">{tab.badge}</span>
              ) : null}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
