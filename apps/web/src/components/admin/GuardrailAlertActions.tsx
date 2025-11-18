'use client';

import { useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";

import { trackGuardrailAlert, trackGuardrailAutomation } from "@/lib/telemetry/events";
import type { GuardrailAlert, GuardrailAutomationTelemetryEvent, GuardrailFollowUpAction } from "@/types/reporting";
import { uploadGuardrailAttachment, type GuardrailAttachment } from "@/lib/guardrail-attachments";

type GuardrailAlertActionsProps = {
  alert: GuardrailAlert;
  conversionCursor: string | null;
  conversionHref: string;
};

const quickActions: Array<{ value: GuardrailFollowUpAction; label: string }> = [
  { value: "escalate", label: "Escalate to ops" },
  { value: "pause", label: "Pause variant" },
  { value: "resume", label: "Resume automation" },
];

export function GuardrailAlertActions({ alert, conversionCursor, conversionHref }: GuardrailAlertActionsProps) {
  const guardrailStatus = alert.severity === "critical" ? "breached" : "warning";
  const primaryContext = alert.platformContexts?.[0] ?? null;
  const [selectedAction, setSelectedAction] = useState<GuardrailFollowUpAction>("escalate");
  const [notes, setNotes] = useState("");
  const [submissionState, setSubmissionState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [attachments, setAttachments] = useState<GuardrailAttachment[]>([]);
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "error">("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleInvestigate = () => {
    void trackGuardrailAlert({
      slug: alert.providerId,
      variantKey: alert.providerName,
      severity: alert.severity,
      tags: {
        experimentSlug: alert.providerId,
        experimentVariant: alert.providerName,
        guardrailStatus,
        platformSlug: primaryContext?.id ?? null,
      },
    });
  };

  const handleAutomationLink = (action: GuardrailFollowUpAction) => {
    void trackGuardrailAutomation({
      slug: alert.providerId,
      variantKey: alert.providerName,
      action,
      tags: {
        experimentSlug: alert.providerId,
        experimentVariant: alert.providerName,
        guardrailStatus,
        platformSlug: primaryContext?.id ?? null,
      },
      providerId: alert.providerId,
    });
  };

  const logFollowUp = async (action: GuardrailFollowUpAction, followUpNotes: string | null = null) => {
    if (submissionState === "saving") {
      return;
    }
    setSubmissionState("saving");
    const payload = {
      providerId: alert.providerId,
      providerName: alert.providerName,
      action,
      notes: followUpNotes,
      platformContext: primaryContext
        ? {
            id: primaryContext.id,
            label: primaryContext.label,
            handle: primaryContext.handle ?? null,
            platformType: primaryContext.platformType ?? null,
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
        action,
        tags: {
          experimentSlug: alert.providerId,
          experimentVariant: alert.providerName,
          guardrailStatus,
          platformSlug: primaryContext?.id ?? null,
        },
        providerId: alert.providerId,
        metadata: {
          note: followUpNotes,
        },
      });

      setSubmissionState("saved");
      setNotes("");
      setAttachments([]);
      window.setTimeout(() => setSubmissionState("idle"), 2000);
    } catch (error) {
      console.warn("Failed to log guardrail follow-up", error);
      setSubmissionState("error");
      window.setTimeout(() => setSubmissionState("idle"), 2500);
    }
  };

  const handleLogFollowUp = async () => {
    await logFollowUp(selectedAction, notes ? notes.trim() : null);
  };
  const handleAttachmentSelect = () => fileInputRef.current?.click();
  const handleAttachmentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploadState("uploading");
    try {
      const attachment = await uploadGuardrailAttachment(file);
      setAttachments((prev) => [...prev, attachment]);
      setUploadState("idle");
    } catch (error) {
      console.warn("Failed to upload guardrail attachment", error);
      setUploadState("error");
      window.setTimeout(() => setUploadState("idle"), 2500);
    }
    event.target.value = "";
  };

  return (
    <>
      <Link
        href={alert.linkHref}
        className="rounded-full border border-white/20 px-4 py-1 text-white/80 transition hover:border-white/50 hover:text-white"
        onClick={handleInvestigate}
      >
        Investigate
      </Link>
      {alert.automationHref ? (
        <Link
          href={alert.automationHref}
          className="rounded-full border border-white/20 px-4 py-1 text-white/80 transition hover:border-white/50 hover:text-white"
          onClick={() => handleAutomationLink("escalate")}
        >
          Automation logs
        </Link>
      ) : null}

      <div className="flex flex-wrap gap-2 text-xs">
        <button
          type="button"
          onClick={() => logFollowUp("pause", "Paused via reporting badge")}
          disabled={submissionState === "saving"}
          className="rounded-full border border-rose-400/40 bg-rose-400/10 px-3 py-1 font-semibold text-rose-100 transition hover:border-rose-300/70 hover:bg-rose-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Pause variant
        </button>
        <button
          type="button"
          onClick={() => logFollowUp("resume", "Resumed via reporting badge")}
          disabled={submissionState === "saving"}
          className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 font-semibold text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Resume automation
        </button>
      </div>
      <div className="w-full rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Evidence</p>
          <button
            type="button"
            onClick={handleAttachmentSelect}
            disabled={uploadState === "uploading"}
            className="rounded-full border border-white/20 px-3 py-1 text-[0.6rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploadState === "uploading" ? "Uploading…" : "Upload"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={handleAttachmentChange}
          />
        </div>
        {uploadState === "error" ? <p className="text-[0.6rem] text-rose-200">Upload failed. Try again.</p> : null}
        {attachments.length === 0 ? (
          <p className="mt-2 rounded border border-dashed border-white/10 p-2 text-white/50">No attachments yet.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
                  className="rounded-full border border-white/20 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] text-white/70">
        <label htmlFor={`guardrail-action-${alert.id}`} className="text-[10px] font-semibold uppercase tracking-[0.3em] text-white/40">
          Follow-up
        </label>
        <select
          id={`guardrail-action-${alert.id}`}
          className="rounded border border-white/20 bg-black/30 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/50"
          value={selectedAction}
          onChange={(event) => setSelectedAction(event.target.value as GuardrailFollowUpAction)}
        >
          {quickActions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Notes (optional)"
          className="min-w-[120px] flex-1 rounded border border-white/20 bg-black/50 px-2 py-1 text-xs text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50"
        />
        <button
          type="button"
          className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleLogFollowUp}
          disabled={submissionState === "saving"}
        >
          {submissionState === "saved" ? "Logged" : submissionState === "error" ? "Retry" : "Log follow-up"}
        </button>
      </div>
    </>
  );
}
