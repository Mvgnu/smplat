"use client";

// meta: component: HostedSessionActions
// meta: feature: hosted-session-analytics

import { useState, type ReactNode } from "react";

import { Mail, MessageSquare, RefreshCcw } from "lucide-react";

import type { HostedSessionReport } from "@/server/billing/types";

type HostedSessionActionsProps = {
  report: HostedSessionReport;
};

export function HostedSessionActions({ report }: HostedSessionActionsProps) {
  const [actionState, setActionState] = useState<"idle" | "regenerating" | "notifying">("idle");

  async function handleRegenerate() {
    setActionState("regenerating");
    try {
      console.info("Regeneration workflow queued", {
        workspaceId: report.workspaceId,
        pendingRegeneration: report.metrics.pendingRegeneration,
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
    } finally {
      setActionState("idle");
    }
  }

  async function handleNotify() {
    setActionState("notifying");
    try {
      console.info("Recovery nudges drafted", {
        workspaceId: report.workspaceId,
        abandonmentReasons: report.abandonmentReasons.slice(0, 3),
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
    } finally {
      setActionState("idle");
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-4 text-sm text-white/70">
      <ActionRow
        icon={<RefreshCcw className="h-4 w-4" />}
        title="Regenerate stalled sessions"
        description={`${report.metrics.pendingRegeneration} sessions are scheduled for automated retry.`}
        actionLabel={actionState === "regenerating" ? "Queuing..." : "Force regeneration sweep"}
        onAction={handleRegenerate}
        disabled={actionState !== "idle"}
      />
      <ActionRow
        icon={<Mail className="h-4 w-4" />}
        title="Email recovery prompts"
        description="Send templated emails to customers whose sessions failed repeatedly."
        actionLabel={actionState === "notifying" ? "Drafting..." : "Draft recovery emails"}
        onAction={handleNotify}
        disabled={actionState !== "idle"}
      />
      <ActionRow
        icon={<MessageSquare className="h-4 w-4" />}
        title="Escalate to account team"
        description="Share abandonment insights with operators for direct follow-up."
        actionLabel="Copy summary"
        onAction={() => {
          if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard
              .writeText(buildSummary(report))
              .then(() => console.info("Hosted session summary copied for operators"))
              .catch((error) => console.warn("Failed to copy hosted session summary", error));
          } else {
            console.warn("Clipboard API unavailable; hosted session summary not copied");
          }
        }}
        disabled={actionState !== "idle"}
      />
    </div>
  );
}

type ActionRowProps = {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
  disabled?: boolean;
};

function ActionRow({ icon, title, description, actionLabel, onAction, disabled = false }: ActionRowProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex items-center gap-3 text-white">
        <span className="rounded-full bg-white/10 p-2 text-white">{icon}</span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs text-white/60">{description}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void onAction()}
        disabled={disabled}
        className="self-start rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function buildSummary(report: HostedSessionReport): string {
  const topReasons = report.abandonmentReasons
    .slice(0, 3)
    .map((reason) => `${reason.reason}: ${reason.count}`)
    .join(", ");
  return `Workspace ${report.workspaceId} • Conversion ${Math.round(
    report.metrics.conversionRate * 100,
  )}% • Abandonment ${Math.round(report.metrics.abandonmentRate * 100)}% • Reasons ${topReasons}`;
}
