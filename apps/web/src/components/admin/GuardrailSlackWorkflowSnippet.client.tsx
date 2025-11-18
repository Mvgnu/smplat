"use client";

import { formatDistanceToNow } from "date-fns";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";

import type { GuardrailAlert, GuardrailFollowUpAction, GuardrailFollowUpFeed, GuardrailWorkflowTelemetrySummary } from "@/types/reporting";
import type { ProviderAutomationTelemetry } from "@/lib/provider-service-insights";
import { uploadGuardrailAttachment, type GuardrailAttachment } from "@/lib/guardrail-attachments";
import { trackGuardrailAutomation, trackGuardrailWorkflow } from "@/lib/telemetry/events";
import { QuickOrderWorkflowTelemetry } from "@/components/account/QuickOrderWorkflowTelemetry.client";

type GuardrailSlackWorkflowSnippetProps = {
  alert: GuardrailAlert;
  followUps: GuardrailFollowUpFeed;
  conversionHref: string;
  conversionCursor: string | null;
  workflowTelemetry?: GuardrailWorkflowTelemetrySummary | null;
};

const severityIcon: Record<GuardrailAlert["severity"], string> = {
  critical: ":rotating_light:",
  warning: ":warning:",
};

export function GuardrailSlackWorkflowSnippet({
  alert,
  followUps,
  conversionHref,
  conversionCursor,
  workflowTelemetry = null,
}: GuardrailSlackWorkflowSnippetProps) {
  const router = useRouter();
  const guardrailStatus = alert.severity === "critical" ? "breached" : "warning";
  const [copied, setCopied] = useState<"idle" | "copied" | "error">("idle");
  const [attachments, setAttachments] = useState<GuardrailAttachment[]>([]);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "error">("idle");
  const [followUpAction, setFollowUpAction] = useState<GuardrailFollowUpAction>("escalate");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [submissionState, setSubmissionState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const latestFollowUp = followUps.entries?.[0] ?? null;
  const historicalAttachments = useMemo(
    () => collectHistoricalAttachments(followUps.entries ?? []),
    [followUps.entries],
  );
  const snippet = useMemo(
    () =>
      buildSlackSnippet({
        alert,
        followUps,
        conversionHref,
        conversionCursor,
        latestFollowUpNotes: latestFollowUp?.notes ?? null,
        attachments,
        historicalAttachments,
      }),
    [alert, followUps, conversionCursor, conversionHref, latestFollowUp?.notes, attachments, historicalAttachments],
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      await trackGuardrailAutomation({
        slug: alert.providerId,
        variantKey: alert.providerName,
        action: "escalate",
        providerId: alert.providerId,
        metadata: {
          snippet: "slack_workflow",
          followUpId: latestFollowUp?.id ?? null,
          attachmentCount: attachments.length,
        },
      });
      await trackGuardrailWorkflow({
        workflowAction: "slack.copy",
        providerId: alert.providerId,
        providerName: alert.providerName ?? null,
        metadata: {
          attachmentCount: attachments.length,
        },
      });
      setCopied("copied");
      window.setTimeout(() => setCopied("idle"), 2000);
    } catch (error) {
      console.warn("Unable to copy guardrail Slack snippet", error);
      setCopied("error");
      window.setTimeout(() => setCopied("idle"), 2000);
    }
  };

  const handleAttachmentSelect = () => {
    fileInputRef.current?.click();
  };

  const uploadFile = async (file: File) => {
    setUploadState("uploading");
    try {
      const attachment = await uploadGuardrailAttachment(file);
      setAttachments((prev) => [...prev, attachment]);
      await trackGuardrailWorkflow({
        workflowAction: "attachment.upload",
        providerId: alert.providerId,
        providerName: alert.providerName ?? null,
        metadata: {
          attachmentName: attachment.fileName,
          attachmentSize: attachment.size,
        },
      });
      setUploadState("idle");
    } catch (error) {
      console.warn("Failed to upload guardrail attachment", error);
      setUploadState("error");
      window.setTimeout(() => setUploadState("idle"), 3000);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await uploadFile(file);
    }
    event.target.value = "";
  };

  const handleRemoveAttachment = async (attachment: GuardrailAttachment) => {
    setAttachments((prev) => prev.filter((item) => item.id !== attachment.id));
    await trackGuardrailWorkflow({
      workflowAction: "attachment.remove",
      providerId: alert.providerId,
      providerName: alert.providerName ?? null,
      metadata: {
        attachmentName: attachment.fileName,
      },
    });
  };

  const handleCopyAttachment = async (attachment: Pick<GuardrailAttachment, "assetUrl" | "fileName">) => {
    try {
      await navigator.clipboard.writeText(attachment.assetUrl);
      await trackGuardrailWorkflow({
        workflowAction: "attachment.copy",
        providerId: alert.providerId,
        providerName: alert.providerName ?? null,
        metadata: {
          attachmentName: attachment.fileName,
        },
      });
    } catch (error) {
      console.warn("Unable to copy attachment URL", error);
    }
  };

  const handleTagHistoricalAttachment = async (attachment: GuardrailAttachment) => {
    setAttachments((prev) => {
      if (prev.some((item) => item.id === attachment.id)) {
        return prev;
      }
      return [...prev, attachment];
    });
    await trackGuardrailWorkflow({
      workflowAction: "attachment.tag",
      providerId: alert.providerId,
      providerName: alert.providerName ?? null,
      metadata: {
        attachmentName: attachment.fileName,
      },
    });
  };

  const handleLogFollowUp = async () => {
    if (submissionState === "saving") {
      return;
    }
    setSubmissionState("saving");
    const trimmedNotes = followUpNotes.trim();
    const platformContext = alert.platformContexts?.[0] ?? null;
    const payload = {
      providerId: alert.providerId,
      providerName: alert.providerName,
      action: followUpAction,
      notes: trimmedNotes.length ? trimmedNotes : null,
      platformContext: platformContext
        ? {
            id: platformContext.id,
            label: platformContext.label,
            handle: platformContext.handle ?? null,
            platformType: platformContext.platformType ?? null,
          }
        : null,
      conversionCursor: conversionCursor ?? null,
      conversionHref,
      attachments:
        attachments.length > 0
          ? attachments.map((attachment) => ({
              id: attachment.id,
              fileName: attachment.fileName,
              assetUrl: attachment.assetUrl,
              storageKey: attachment.storageKey,
              size: attachment.size,
              contentType: attachment.contentType,
              uploadedAt: attachment.uploadedAt,
            }))
          : null,
    };
    try {
      const response = await fetch("/api/reporting/guardrail-followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error("Failed to record guardrail follow-up");
      }
      await trackGuardrailAutomation({
        slug: alert.providerId,
        variantKey: alert.providerName,
        action: followUpAction,
        providerId: alert.providerId,
        tags: {
          platformSlug: platformContext?.id ?? null,
          guardrailStatus,
        },
        metadata: {
          note: trimmedNotes.length ? trimmedNotes : null,
          source: "slack-snippet",
        },
      });
      await trackGuardrailWorkflow({
        workflowAction: "slack.followup.log",
        providerId: alert.providerId,
        providerName: alert.providerName ?? null,
        metadata: {
          action: followUpAction,
          attachmentCount: attachments.length,
        },
      });
      setSubmissionState("saved");
      setFollowUpNotes("");
      setAttachments([]);
      router.refresh();
      window.setTimeout(() => setSubmissionState("idle"), 2000);
    } catch (error) {
      console.warn("Unable to record guardrail follow-up from Slack composer", error);
      setSubmissionState("error");
      window.setTimeout(() => setSubmissionState("idle"), 2500);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-white/70">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Slack handoff</p>
        <button
          type="button"
          onClick={handleCopy}
          className="rounded-full border border-white/30 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60 hover:text-white"
        >
          {copied === "copied" ? "Snippet copied" : copied === "error" ? "Retry copy" : "Copy Slack alert"}
        </button>
      </div>
      <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3">
        <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Workflow telemetry</p>
        <QuickOrderWorkflowTelemetry
          initialTelemetry={workflowTelemetry ?? null}
          refreshIntervalMs={60_000}
          testId="workflow-telemetry-slack-snippet"
        />
      </div>
      <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/30 p-3 text-xs text-white/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Attachments</p>
            <p className="text-xs text-white/60">
              Upload screenshots or receipt snippets. Links auto-embed in the Slack template.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAttachmentSelect}
              className="rounded-full border border-white/20 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:border-white/50 hover:text-white"
              disabled={uploadState === "uploading"}
            >
              {uploadState === "uploading" ? "Uploading…" : "Upload"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
        {uploadState === "error" ? (
          <p className="text-[0.65rem] text-rose-200">Upload failed. Try again.</p>
        ) : null}
        {attachments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 p-3 text-white/50">
            No attachments yet. Upload screenshots or drop receipt exports so ops can reference them in Slack.
          </p>
        ) : (
          <ul className="space-y-2">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-white">{attachment.fileName}</p>
                  <p className="text-[0.65rem] text-white/50">
                    {formatBytes(attachment.size)} • {attachment.contentType || "binary"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyAttachment(attachment)}
                  className="rounded-full border border-white/20 px-2 py-1 text-[0.6rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                >
                  Copy link
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveAttachment(attachment)}
                  className="rounded-full border border-white/20 px-2 py-1 text-[0.6rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/70">
          <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Persist follow-up</p>
          <div className="flex flex-wrap items-center gap-2 text-[0.65rem]">
            <label
              htmlFor={`followup-action-${alert.id}`}
              className="text-[0.55rem] font-semibold uppercase tracking-[0.3em] text-white/40"
            >
              Action
            </label>
            <select
              id={`followup-action-${alert.id}`}
              value={followUpAction}
              onChange={(event) => setFollowUpAction(event.target.value as GuardrailFollowUpAction)}
              className="rounded border border-white/20 bg-black/50 px-2 py-1 text-[0.7rem] text-white focus:outline-none focus:ring-1 focus:ring-white/50"
            >
              <option value="escalate">Escalate</option>
              <option value="pause">Pause</option>
              <option value="resume">Resume</option>
            </select>
            <input
              type="text"
              value={followUpNotes}
              onChange={(event) => setFollowUpNotes(event.target.value)}
              placeholder="Notes (optional)"
              className="min-w-[140px] flex-1 rounded border border-white/20 bg-black/50 px-2 py-1 text-[0.7rem] text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50"
            />
            <button
              type="button"
              onClick={handleLogFollowUp}
              disabled={submissionState === "saving"}
              className="rounded-full bg-white px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submissionState === "saved" ? "Logged" : submissionState === "error" ? "Retry" : "Log follow-up"}
            </button>
          </div>
          {submissionState === "error" ? (
            <p className="text-[0.6rem] text-rose-200">Unable to record follow-up. Try again.</p>
          ) : null}
          {submissionState === "saved" ? (
            <p className="text-[0.6rem] text-emerald-200">Follow-up recorded.</p>
          ) : null}
        </div>
        {historicalAttachments.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3 text-xs text-white/70">
            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
              Evidence on file ({historicalAttachments.length})
            </p>
            <ul className="space-y-1">
              {historicalAttachments.map((attachment) => (
                <li key={attachment.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-white">{attachment.fileName}</span>
                  <span className="text-[0.6rem] text-white/50">{formatBytes(attachment.size ?? 0)}</span>
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-2 py-1 text-[0.6rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={attachments.some((item) => item.id === attachment.id)}
                    onClick={() => handleTagHistoricalAttachment(attachment)}
                  >
                    {attachments.some((item) => item.id === attachment.id) ? "Tagged" : "Tag"}
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-white/20 px-2 py-1 text-[0.6rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white"
                    onClick={() => handleCopyAttachment({ assetUrl: attachment.assetUrl, fileName: attachment.fileName })}
                  >
                    Copy
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-black/40 p-3 text-xs text-white/80">{snippet}</pre>
    </div>
  );
}

function buildSlackSnippet({
  alert,
  followUps,
  conversionCursor,
  conversionHref,
  latestFollowUpNotes,
  attachments,
  historicalAttachments,
}: {
  alert: GuardrailAlert;
  followUps: GuardrailFollowUpFeed;
  conversionCursor: string | null;
  conversionHref: string;
  latestFollowUpNotes: string | null;
  attachments: GuardrailAttachment[];
  historicalAttachments: GuardrailAttachment[];
}): string {
  const telemetry = followUps.providerTelemetry;
  const conversionLabel = conversionCursor
    ? `Historical conversion slice (cursor ${conversionCursor})`
    : "Live conversion snapshot";
  const automationHref =
    alert.automationHref ?? `/admin/fulfillment/providers/${alert.providerId}?tab=automation`;
  const followUpStatus = describeLatestFollowUp(followUps);
  const latestFollowUpId = followUps.entries?.[0]?.id ?? null;
  const platformLabel = alert.platformContexts?.[0]
    ? alert.platformContexts.map((context) => `${context.label ?? context.handle ?? context.id}`).join(", ")
    : "Add platform context";
  const followUpAnchor = latestFollowUpId ? `${automationHref}#follow-up-${latestFollowUpId}` : automationHref;

  const lines: string[] = [
    `${severityIcon[alert.severity]} Guardrail alert — *${alert.providerName}* (\`${alert.providerId}\`)`,
    `• Guardrail fails ${alert.guardrailFailures} · warnings ${alert.guardrailWarnings}`,
    `• Replays ${alert.replayFailures}/${alert.replayTotal || 0}`,
    `• Platform context: ${platformLabel}`,
  ];

  if (telemetry) {
    lines.push(formatTelemetryLine(telemetry));
    const hotspots = selectHotspots(telemetry.guardrailHitsByService);
    if (hotspots) {
      lines.push(`• Hotspots: ${hotspots}`);
    }
  }

  if (alert.reasons.length) {
    lines.push(`• Reasons: ${alert.reasons.join(", ")}`);
  }

  lines.push(`• Latest follow-up: ${followUpStatus}`);
  if (latestFollowUpNotes) {
    lines.push(`• Notes: ${latestFollowUpNotes.trim()}`);
  }
  if (attachments.length > 0) {
    lines.push("• Attachments:");
    attachments.forEach((attachment, index) => {
      const label = attachment.fileName || `Attachment ${index + 1}`;
      lines.push(`  - ${label}: ${attachment.assetUrl}`);
    });
  }
  if (historicalAttachments.length > 0) {
    lines.push("• Evidence on file:");
    historicalAttachments.slice(0, 5).forEach((attachment, index) => {
      const label = attachment.fileName || `Evidence ${index + 1}`;
      lines.push(`  - ${label}: ${attachment.assetUrl}`);
    });
  }
  lines.push(`<${alert.linkHref}|Investigate dashboard> · <${followUpAnchor}|Latest follow-up>`);
  lines.push(`${conversionLabel}: <${conversionHref}|Open conversions>`);
  lines.push("• Attach screenshots or delivery proof snippets for Slack context.");

  return lines.join("\n");
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "—";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  const value = size / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function collectHistoricalAttachments(
  entries: GuardrailFollowUpFeed["entries"],
): GuardrailAttachment[] {
  if (!Array.isArray(entries)) {
    return [];
  }
  const seen = new Map<string, GuardrailAttachment>();
  for (const entry of entries) {
    if (!entry.attachments) {
      continue;
    }
    for (const attachment of entry.attachments) {
      if (!attachment.id || !attachment.assetUrl) {
        continue;
      }
      if (!seen.has(attachment.id)) {
        seen.set(attachment.id, {
          id: attachment.id,
          fileName: attachment.fileName,
          assetUrl: attachment.assetUrl,
          storageKey: attachment.storageKey,
          size: attachment.size,
          contentType: attachment.contentType,
          uploadedAt: attachment.uploadedAt,
        });
      }
    }
  }
  return Array.from(seen.values());
}

function describeLatestFollowUp(feed: GuardrailFollowUpFeed): string {
  if (!feed.entries?.length) {
    return "No follow-up logged yet";
  }
  const entry = feed.entries[0];
  const recordedAt = formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true });
  return `${entry.action} (${recordedAt})`;
}

function formatTelemetryLine(telemetry: ProviderAutomationTelemetry): string {
  return `• Telemetry: ${telemetry.totalOrders} orders · guardrail ${telemetry.guardrails.fail}/${telemetry.guardrails.evaluated} fail/eval · replays ${telemetry.replays.failed}/${telemetry.replays.total} failed`;
}

function selectHotspots(
  map: ProviderAutomationTelemetry["guardrailHitsByService"],
  limit = 2,
): string | null {
  if (!map) {
    return null;
  }
  const entries = Object.entries(map)
    .filter(([, summary]) => summary.fail > 0 || summary.warn > 0)
    .sort((a, b) => b[1].fail - a[1].fail || b[1].warn - a[1].warn)
    .slice(0, limit)
    .map(([serviceId, summary]) => `${serviceId}: warn ${summary.warn}, fail ${summary.fail}`);
  return entries.length ? entries.join(" · ") : null;
}
