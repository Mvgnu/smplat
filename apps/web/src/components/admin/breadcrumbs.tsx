"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// meta: component: AdminBreadcrumbs
// meta: owner: platform

export type AdminBreadcrumb = {
  label: string;
  href?: string;
  icon?: ReactNode;
};

export type AdminBreadcrumbsProps = {
  items: AdminBreadcrumb[];
  trailingAction?: ReactNode;
};

export function AdminBreadcrumbs({ items, trailingAction }: AdminBreadcrumbsProps) {
  return (
    <nav className="flex items-center justify-between gap-4 text-xs text-white/50" aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          if (isLast) {
            return (
              <li key={item.label} className="inline-flex items-center gap-1 text-white/80">
                {item.icon}
                <span className="font-medium uppercase tracking-[0.3em]">{item.label}</span>
              </li>
            );
          }

          return (
            <li key={item.label} className="inline-flex items-center gap-2">
              <Link
                className="inline-flex items-center gap-1 uppercase tracking-[0.3em] text-white/40 transition hover:text-white/70"
                href={item.href ?? "#"}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
              <span className="text-white/30">/</span>
            </li>
          );
        })}
      </ol>
      {trailingAction ? <div className="text-white/60">{trailingAction}</div> : null}
    </nav>
  );
}
