"use client";

import { useState } from "react";

type CopyEscalationSnippetButtonProps = {
  providerName: string;
  providerId: string;
  conversionHref: string;
  conversionCursor: string | null;
  guardrailAction: string | null;
  guardrailNotes: string | null;
  followUpHref: string;
  platformContextLabel?: string | null;
};

const actionLabels: Record<string, string> = {
  pause: "Paused variant",
  resume: "Resumed automation",
  escalate: "Escalated to ops",
};

function formatAction(value: string | null): string {
  if (!value) {
    return "Add latest follow-up";
  }
  return actionLabels[value] ?? value;
}

export function CopyEscalationSnippetButton({
  providerId,
  providerName,
  conversionHref,
  conversionCursor,
  guardrailAction,
  guardrailNotes,
  followUpHref,
  platformContextLabel,
}: CopyEscalationSnippetButtonProps) {
  const [copied, setCopied] = useState(false);

  const buildSnippet = () => {
    const conversionLabel = conversionCursor
      ? `Historical conversion slice (cursor ${conversionCursor})`
      : "Live conversion slice";
    const platformLine =
      platformContextLabel ?? "Add platform context (e.g., Instagram DM Concierge)";
    const template = [
      `:warning: Catalog QA escalation – *${providerName}* \`${providerId}\``,
      "• Issue: <describe the observed storefront/catalog issue>",
      `• Guardrail action: ${formatAction(guardrailAction)} · Notes: ${guardrailNotes?.trim() ?? "Add notes here"}`,
      `• Platform context: ${platformLine}`,
      `• ${conversionLabel}: <${conversionHref}|Open conversions>`,
      `• Follow-up timeline: <${followUpHref}|Open provider>`,
      "• Attachments: <link screenshots or logs>",
    ];
    return template.join("\n");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildSnippet());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.warn("Failed to copy escalation snippet", error);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center rounded-full border border-white/30 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60 hover:text-white"
    >
      {copied ? "Snippet copied" : "Copy escalation snippet"}
    </button>
  );
}
