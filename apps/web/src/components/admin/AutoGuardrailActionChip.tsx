"use client";

import Link from "next/link";

import { buildAutoActionTooltip, type ProviderAutoAction } from "@/lib/automation-actions";

type AutoGuardrailActionChipProps = {
  action: ProviderAutoAction;
  linkLabel?: string;
};

export function AutoGuardrailActionChip({ action, linkLabel = "Open follow-ups" }: AutoGuardrailActionChipProps) {
  const tooltip = buildAutoActionTooltip(action);
  const href = action.automationHref ?? null;
  const colorClasses =
    action.action === "pause"
      ? "border-rose-400/40 bg-rose-500/10 text-rose-100"
      : "border-emerald-400/40 bg-emerald-500/10 text-emerald-100";

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-2 rounded-full border px-3 py-1 text-[0.65rem] uppercase tracking-[0.2em] ${colorClasses}`}
      title={tooltip}
    >
      <span className="font-semibold">{action.action === "pause" ? "Auto pause" : "Auto resume"}</span>
      <span className="font-normal text-white/80">{action.providerName}</span>
      {href ? (
        <Link
          href={href}
          className="inline-flex items-center rounded-full border border-white/20 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.3em] text-white/70 transition hover:border-white/50 hover:text-white"
        >
          {linkLabel}
        </Link>
      ) : null}
    </span>
  );
}
