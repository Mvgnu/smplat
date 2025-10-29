"use client";

import type { ReactNode } from "react";

// meta: component: AdminKpiCard
// meta: owner: platform

export type AdminKpiCardProps = {
  label: string;
  value: ReactNode;
  change?: {
    direction: "up" | "down" | "flat";
    label: string;
  };
  footer?: ReactNode;
};

export function AdminKpiCard({ label, value, change, footer }: AdminKpiCardProps) {
  const changeTone =
    change?.direction === "up"
      ? "text-emerald-300"
      : change?.direction === "down"
        ? "text-rose-300"
        : "text-white/60";

  return (
    <article className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 text-white shadow-[0_20px_60px_-35px_rgba(15,65,255,0.65)]">
      <header className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
        <span>{label}</span>
        {change ? <span className={changeTone}>{change.label}</span> : null}
      </header>
      <div className="text-3xl font-semibold text-white">{value}</div>
      {footer ? <footer className="text-xs text-white/50">{footer}</footer> : null}
    </article>
  );
}
