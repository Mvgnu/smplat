"use client";

import type { ButtonHTMLAttributes } from "react";

// meta: component: AdminFilterPill
// meta: owner: platform

export type AdminFilterPillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
};

export function AdminFilterPill({ active = false, children, className = "", ...props }: AdminFilterPillProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black ${
        active
          ? "border-white/40 bg-white/15 text-white"
          : "border-white/15 bg-white/5 text-white/60 hover:border-white/30 hover:text-white"
      } ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
