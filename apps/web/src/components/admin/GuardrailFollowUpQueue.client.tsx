"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import type { GuardrailQueueEntry } from "@/types/guardrail-queue";
import type { GuardrailFollowUpAction, GuardrailWorkflowTelemetrySummary } from "@/types/reporting";
import { trackGuardrailAutomation, trackGuardrailWorkflow } from "@/lib/telemetry/events";
import { uploadGuardrailAttachment, type GuardrailAttachment } from "@/lib/guardrail-attachments";
import { QuickOrderWorkflowTelemetry } from "@/components/account/QuickOrderWorkflowTelemetry.client";

type GuardrailFollowUpQueueClientProps = {
  entries: GuardrailQueueEntry[];
  workflowTelemetry?: GuardrailWorkflowTelemetrySummary | null;
};

type QueueFilter = "all" | "critical" | "warning";
const PLATFORM_NO_CONTEXT = "__none__";

const severityTone: Record<Exclude<QueueFilter, "all">, string> = {
  critical: "border-rose-500/40 bg-rose-500/10 text-rose-100",
  warning: "border-amber-400/40 bg-amber-400/10 text-amber-100",
};

export function GuardrailFollowUpQueueClient({ entries, workflowTelemetry = null }: GuardrailFollowUpQueueClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [providerFilter, setProviderFilter] = useState(() => {
    const queryValue = searchParams.get("guardrailProvider");
    if (queryValue !== null) {
      return queryValue;
    }
    return getStoredFilter("providerFilter", "");
  });
  const [platformFilter, setPlatformFilter] = useState(() => {
    const queryValue = searchParams.get("guardrailPlatform");
    if (queryValue) {
      return queryValue;
    }
    return getStoredFilter("platformFilter", "all");
  });
  const [severityFilters, setSeverityFilters] = useState<Record<Exclude<QueueFilter, "all">, boolean>>(() => {
    const query = searchParams.get("guardrailSeverity");
    if (query) {
      const parsed = parseSeverityQuery(query);
      if (parsed) {
        return parsed;
      }
    }
    const stored = getStoredFilter("severityFilters", null);
    if (stored && typeof stored === "object") {
      const parsed = stored as Record<string, unknown>;
      return {
        critical: Boolean(parsed.critical ?? true),
        warning: Boolean(parsed.warning ?? true),
      };
    }
    return { critical: true, warning: true };
  });
  const [notesByProvider, setNotesByProvider] = useState<Record<string, string>>({});
  const [actionByProvider, setActionByProvider] = useState<Record<string, GuardrailFollowUpAction>>({});
  const [submissionState, setSubmissionState] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [queuedUpdates, setQueuedUpdates] = useState<Record<string, GuardrailQueueEntry[]>>({});
  const [attachmentCopyState, setAttachmentCopyState] = useState<Record<string, "idle" | "copied">>({});
  const [attachmentsByProvider, setAttachmentsByProvider] = useState<Record<string, GuardrailAttachment[]>>({});
  const [attachmentUploadState, setAttachmentUploadState] = useState<Record<string, "idle" | "uploading" | "error">>({});

  const counts = useMemo(() => {
    return entries.reduce<{ critical: number; warning: number }>(
      (acc, entry) => {
        acc[entry.severity] += 1;
        return acc;
      },
      { critical: 0, warning: 0 },
    );
  }, [entries]);
  const platformOptions = useMemo(() => {
    const labels = new Map<string, string>();
    for (const entry of entries) {
      if (entry.platformContext?.id) {
        const label = entry.platformContext.label ?? entry.platformContext.id;
        labels.set(entry.platformContext.id, label);
      }
    }
    return Array.from(labels.entries()).map(([id, label]) => ({ id, label }));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const query = providerFilter.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!severityFilters[entry.severity]) {
        return false;
      }
       if (platformFilter === PLATFORM_NO_CONTEXT) {
         if (entry.platformContext) {
           return false;
         }
       } else if (platformFilter !== "all" && entry.platformContext?.id !== platformFilter) {
         return false;
       }
      if (!query) {
        return true;
      }
      return (
        entry.providerName.toLowerCase().includes(query) ||
        entry.providerId.toLowerCase().includes(query)
      );
    });
  }, [entries, platformFilter, providerFilter, severityFilters]);

  const isFilterDirty =
    providerFilter.trim().length > 0 ||
    platformFilter !== "all" ||
    !severityFilters.critical ||
    !severityFilters.warning;

  useEffect(() => {
    setQueuedUpdates({});
  }, [entries]);

  useEffect(() => {
    try {
      localStorage.setItem(mapFilterKey("providerFilter"), providerFilter);
    } catch {
      // ignore
    }
  }, [providerFilter]);
  useEffect(() => {
    try {
      localStorage.setItem(mapFilterKey("platformFilter"), platformFilter);
    } catch {
      // ignore
    }
  }, [platformFilter]);

  useEffect(() => {
    try {
      localStorage.setItem(mapFilterKey("severityFilters"), JSON.stringify(severityFilters));
    } catch {
      // ignore
    }
  }, [severityFilters]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const trimmed = providerFilter.trim();
    if (trimmed.length > 0) {
      params.set("guardrailProvider", trimmed);
    } else {
      params.delete("guardrailProvider");
    }
    const activeSeverities = (["critical", "warning"] as Array<Exclude<QueueFilter, "all">>).filter(
      (value) => severityFilters[value],
    );
    if (activeSeverities.length === 0 || activeSeverities.length === 2) {
      params.delete("guardrailSeverity");
    } else {
      params.set("guardrailSeverity", activeSeverities.join(","));
    }
    if (platformFilter && platformFilter !== "all") {
      params.set("guardrailPlatform", platformFilter);
    } else {
      params.delete("guardrailPlatform");
    }
    const nextSearch = params.toString();
    const nextHref = nextSearch.length ? `${pathname}?${nextSearch}` : pathname;
    const currentSearch = window.location.search.replace(/^\?/, "");
    if (currentSearch === nextSearch) {
      return;
    }
    router.replace(nextHref, { scroll: false });
  }, [platformFilter, providerFilter, severityFilters, pathname, router]);

  const visibleEntries = useMemo(() => {
    const queueKeys = Object.keys(queuedUpdates);
    if (!queueKeys.length) {
      return filteredEntries;
    }
    const merged = [...filteredEntries];
    for (const providerId of queueKeys) {
      const index = merged.findIndex((entry) => entry.providerId === providerId);
      if (index !== -1) {
        merged.splice(index, 1, ...queuedUpdates[providerId]);
      } else {
        merged.unshift(...queuedUpdates[providerId]);
      }
    }
    return merged;
  }, [filteredEntries, queuedUpdates]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex flex-wrap gap-2 font-semibold uppercase tracking-[0.2em] text-white/60">
          {(["critical", "warning"] as Array<Exclude<QueueFilter, "all">>).map((value) => {
            const isActive = severityFilters[value];
            return (
              <button
                key={value}
                type="button"
                className={`rounded-full border px-4 py-1 transition ${
                  isActive
                    ? value === "critical"
                      ? "border-rose-300/70 text-white"
                      : "border-amber-300/70 text-white"
                    : "border-white/20 text-white/60 hover:border-white/40 hover:text-white"
                }`}
                onClick={() =>
                  setSeverityFilters((prev) => ({
                    ...prev,
                    [value]: !prev[value],
                  }))
                }
              >
                {value === "critical" ? "Critical" : "Warning"} ·{" "}
                <span className="font-mono text-[0.7rem]">{counts[value]}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-1 items-center gap-2">
          <input
            type="text"
            placeholder="Filter by provider"
            value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)}
            className="min-w-[180px] flex-1 rounded-full border border-white/20 bg-black/30 px-4 py-1 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/40"
          />
          <select
            value={platformFilter}
            onChange={(event) => setPlatformFilter(event.target.value)}
            className="min-w-[150px] rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/70 focus:outline-none focus:ring-1 focus:ring-white/40"
          >
            <option value="all">All platforms</option>
            {platformOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            <option value={PLATFORM_NO_CONTEXT}>No platform context</option>
          </select>
          {isFilterDirty ? (
            <button
              type="button"
              onClick={() => {
                setProviderFilter("");
                setPlatformFilter("all");
                setSeverityFilters({ critical: true, warning: true });
              }}
              className="rounded-full border border-white/20 px-3 py-1 text-[0.7rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white"
            >
              Reset filters
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
          <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Workflow telemetry</p>
          <QuickOrderWorkflowTelemetry
            initialTelemetry={workflowTelemetry ?? null}
            refreshIntervalMs={60_000}
            testId="workflow-telemetry-followup-queue"
          />
        </div>
        {visibleEntries.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/20 p-6 text-sm text-white/60">
            No queue entries match the selected filters. Adjust your provider search or severity selections, or document a new action via the provider page.
          </p>
        ) : (
          visibleEntries.map((entry) => (
            <article
              key={`${entry.providerId}-${entry.createdAt}-${entry.action}`}
              className="rounded-2xl border border-white/10 bg-black/20 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/50">{entry.providerId}</p>
                  <p className="text-sm font-semibold text-white">{entry.providerName}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-[0.6rem] font-semibold uppercase tracking-[0.2em]">
                  {entry.isPaused ? (
                    <span className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 text-sky-100">
                      Paused
                    </span>
                  ) : null}
                  <span className={`rounded-full border px-3 py-1 ${severityTone[entry.severity]}`}>
                    {entry.severity === "critical" ? "Critical" : "Warning"}
                  </span>
                </div>
              </div>
              {entry.platformContext ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.65rem] uppercase tracking-[0.2em] text-white/60">
                  <button
                    type="button"
                    className={`rounded-full border px-3 py-1 transition ${
                      platformFilter === entry.platformContext?.id
                        ? "border-white text-white"
                        : "border-white/20 text-white/70 hover:border-white/40 hover:text-white"
                    }`}
                    onClick={() =>
                      setPlatformFilter((prev) =>
                        prev === entry.platformContext?.id ? "all" : entry.platformContext?.id ?? "all",
                      )
                    }
                  >
                    Platform: {entry.platformContext.label ?? entry.platformContext.id}
                    {entry.platformContext.handle ? ` · ${entry.platformContext.handle}` : ""}
                  </button>
                </div>
              ) : platformFilter === PLATFORM_NO_CONTEXT ? (
                <p className="mt-2 text-[0.65rem] uppercase tracking-[0.2em] text-white/50">No platform context</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs font-semibold text-white/80">
                <span className="rounded-full border border-white/20 px-3 py-1 text-[11px] uppercase tracking-[0.2em]">
                  {formatAction(entry.action)}
                </span>
                <Link
                  href={entry.providerHref}
                  className="rounded-full border border-white/20 px-4 py-1 text-[11px] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white"
                >
                  Open provider
                </Link>
              </div>
              {entry.conversionCursor || entry.conversionHref ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/25 px-3 py-2 text-[0.65rem] text-white/70">
                  <span>
                    Conversion context:{" "}
                    {entry.conversionCursor ? `cursor ${entry.conversionCursor}` : "Live snapshot"}
                  </span>
                  {entry.conversionHref ? (
                    <Link
                      href={entry.conversionHref}
                      className="rounded-full border border-white/20 px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-white/80 transition hover:border-white/50 hover:text-white"
                    >
                      Open conversions
                    </Link>
                  ) : null}
                </div>
              ) : null}
              {entry.notes ? <p className="mt-2 text-sm text-white/70">{entry.notes}</p> : null}
              {entry.attachments && entry.attachments.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {entry.attachments.map((attachment) => {
                    const state = attachmentCopyState[attachment.id] ?? "idle";
                    return (
                      <li
                        key={attachment.id}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-2 text-xs text-white/70"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-white">{attachment.fileName}</p>
                          <p className="text-[0.65rem] text-white/50">
                            {formatAttachmentMeta(attachment)}
                          </p>
                        </div>
                        <a
                          href={attachment.assetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/20 px-3 py-1 text-[0.6rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white"
                        >
                          Open
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            void copyAttachmentLink(entry, attachment, setAttachmentCopyState);
                          }}
                          className="rounded-full border border-white/20 px-3 py-1 text-[0.6rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white"
                        >
                          {state === "copied" ? "Copied" : "Copy"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <p className="mt-2 text-xs font-mono text-white/50">{formatTimestamp(entry.createdAt)}</p>
              <WorkflowActionPanel
                entry={entry}
                note={notesByProvider[entry.providerId] ?? ""}
                action={actionByProvider[entry.providerId] ?? "escalate"}
                submissionState={submissionState[entry.providerId] ?? "idle"}
                attachments={attachmentsByProvider[entry.providerId] ?? []}
                uploadingState={attachmentUploadState[entry.providerId] ?? "idle"}
                onNoteChange={(value) =>
                  setNotesByProvider((prev) => ({
                    ...prev,
                    [entry.providerId]: value,
                  }))
                }
                onActionChange={(value) =>
                  setActionByProvider((prev) => ({
                    ...prev,
                    [entry.providerId]: value,
                  }))
                }
                onAttachmentUpload={async (file) => {
                  const providerId = entry.providerId;
                  setAttachmentUploadState((prev) => ({ ...prev, [providerId]: "uploading" }));
                  try {
                    const attachment = await uploadGuardrailAttachment(file);
                    setAttachmentsByProvider((prev) => ({
                      ...prev,
                      [providerId]: [...(prev[providerId] ?? []), attachment],
                    }));
                    setAttachmentUploadState((prev) => ({ ...prev, [providerId]: "idle" }));
                    await trackGuardrailWorkflow({
                      workflowAction: "attachment.upload",
                      providerId: entry.providerId,
                      providerName: entry.providerName,
                      metadata: {
                        attachmentId: attachment.id,
                        attachmentName: attachment.fileName,
                        attachmentSize: attachment.size ?? null,
                      },
                    });
                  } catch (error) {
                    console.warn("Failed to upload guardrail attachment", error);
                    setAttachmentUploadState((prev) => ({ ...prev, [providerId]: "error" }));
                    window.setTimeout(() => {
                      setAttachmentUploadState((prev) => ({ ...prev, [providerId]: "idle" }));
                    }, 2500);
                  }
                }}
                onAttachmentRemove={(attachment) => {
                  setAttachmentsByProvider((prev) => ({
                    ...prev,
                    [entry.providerId]: (prev[entry.providerId] ?? []).filter((item) => item.id !== attachment.id),
                  }));
                  void trackGuardrailWorkflow({
                    workflowAction: "attachment.remove",
                    providerId: entry.providerId,
                    providerName: entry.providerName,
                    metadata: {
                      attachmentId: attachment.id,
                      attachmentName: attachment.fileName,
                    },
                  });
                }}
                onSubmit={async (action, note) => {
                  const stateKey = entry.providerId;
                  if (submissionState[stateKey] === "saving") {
                    return;
                  }
                  setSubmissionState((prev) => ({ ...prev, [stateKey]: "saving" }));
                  try {
                    const pendingAttachments = attachmentsByProvider[stateKey] ?? [];
                    const optimisticEntry = buildOptimisticEntry(entry, action, note, pendingAttachments);
                    setQueuedUpdates((prev) => ({ ...prev, [stateKey]: [optimisticEntry] }));
                    await logGuardrailFollowUp(entry, action, note, pendingAttachments);
                    setSubmissionState((prev) => ({ ...prev, [stateKey]: "saved" }));
                    setNotesByProvider((prev) => ({ ...prev, [stateKey]: "" }));
                    if (pendingAttachments.length > 0) {
                      setAttachmentsByProvider((prev) => ({ ...prev, [stateKey]: [] }));
                    }
                    window.setTimeout(() => {
                      setSubmissionState((prev) => ({ ...prev, [stateKey]: "idle" }));
                    }, 2000);
                    router.refresh();
                  } catch (error) {
                    console.warn("Failed to record workflow action", error);
                    setSubmissionState((prev) => ({ ...prev, [stateKey]: "error" }));
                    setQueuedUpdates((prev) => {
                      if (!prev[stateKey]) {
                        return prev;
                      }
                      const next = { ...prev };
                      delete next[stateKey];
                      return next;
                    });
                    window.setTimeout(() => {
                      setSubmissionState((prev) => ({ ...prev, [stateKey]: "idle" }));
                    }, 2500);
                  }
                }}
              />
            </article>
          ))
        )}
      </div>
    </>
  );
}

const actionLabels: Record<GuardrailQueueEntry["action"], string> = {
  pause: "Paused variant",
  resume: "Resumed automation",
  escalate: "Escalated to ops",
};

const quickActionNotes: Record<GuardrailFollowUpAction, string> = {
  pause: "Paused via workflow board",
  resume: "Resumed via workflow board",
  escalate: "Escalated via workflow board",
};

type WorkflowActionPanelProps = {
  entry: GuardrailQueueEntry;
  note: string;
  action: GuardrailFollowUpAction;
  submissionState: "idle" | "saving" | "saved" | "error";
  attachments: GuardrailAttachment[];
  uploadingState: "idle" | "uploading" | "error";
  onNoteChange: (value: string) => void;
  onActionChange: (value: GuardrailFollowUpAction) => void;
  onAttachmentUpload: (file: File) => Promise<void>;
  onAttachmentRemove: (attachment: GuardrailAttachment) => void;
  onSubmit: (action: GuardrailFollowUpAction, note: string | null) => Promise<void>;
};

function WorkflowActionPanel({
  entry,
  note,
  action,
  submissionState,
  attachments,
  uploadingState,
  onNoteChange,
  onActionChange,
  onAttachmentUpload,
  onAttachmentRemove,
  onSubmit,
}: WorkflowActionPanelProps) {
  const disabled = submissionState === "saving";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handleAttachmentSelect = () => fileInputRef.current?.click();
  const handleAttachmentChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await onAttachmentUpload(file);
    }
    event.target.value = "";
  };
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-black/30 p-3 text-xs text-white/70">
      <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">Workflow actions</p>
      <div className="space-y-2 rounded-xl border border-white/10 bg-black/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.55rem] uppercase tracking-[0.3em] text-white/40">Attach evidence</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleAttachmentSelect}
              disabled={uploadingState === "uploading"}
              className="rounded-full border border-white/20 px-3 py-1 text-[0.6rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadingState === "uploading" ? "Uploading…" : "Upload"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleAttachmentChange}
            />
          </div>
        </div>
        {uploadingState === "error" ? (
          <p className="text-[0.6rem] text-rose-200">Upload failed. Try again.</p>
        ) : null}
        {attachments.length === 0 ? (
          <p className="rounded border border-dashed border-white/10 p-2 text-white/50">No pending evidence.</p>
        ) : (
          <ul className="space-y-1">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center gap-2 rounded border border-white/10 bg-black/60 px-2 py-1">
                <span className="min-w-0 flex-1 truncate text-white">{attachment.fileName}</span>
                <button
                  type="button"
                  onClick={() => onAttachmentRemove(attachment)}
                  className="rounded-full border border-white/20 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.2em] text-white/70 transition hover:border-white/50 hover:text-white"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onSubmit("pause", quickActionNotes.pause)}
          disabled={disabled}
          className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 font-semibold text-rose-100 transition hover:border-rose-300/70 hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Auto-pause
        </button>
        <button
          type="button"
          onClick={() => onSubmit("resume", quickActionNotes.resume)}
          disabled={disabled}
          className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-100 transition hover:border-emerald-300/70 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Resume automation
        </button>
        <button
          type="button"
          onClick={() => onSubmit("escalate", quickActionNotes.escalate)}
          disabled={disabled}
          className="rounded-full border border-sky-400/40 bg-sky-500/10 px-3 py-1 font-semibold text-sky-100 transition hover:border-sky-300/70 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Escalate
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-white/20 bg-black/50 px-2 py-1 text-white focus:outline-none focus:ring-1 focus:ring-white/50"
          value={action}
          onChange={(event) => onActionChange(event.target.value as GuardrailFollowUpAction)}
          disabled={disabled}
        >
          <option value="escalate">Escalate</option>
          <option value="pause">Pause</option>
          <option value="resume">Resume</option>
        </select>
        <input
          type="text"
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="Add workflow note"
          className="min-w-[140px] flex-1 rounded border border-white/20 bg-black/50 px-2 py-1 text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/50"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => onSubmit(action, note.trim().length ? note.trim() : null)}
          disabled={disabled}
          className="rounded-full bg-white px-3 py-1 font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submissionState === "saved" ? "Logged" : submissionState === "error" ? "Retry" : "Log follow-up"}
        </button>
      </div>
      {submissionState === "error" ? (
        <p className="text-[0.65rem] text-rose-200">Unable to record workflow action. Try again.</p>
      ) : null}
      {submissionState === "saved" ? (
        <p className="text-[0.65rem] text-emerald-200">Workflow action recorded.</p>
      ) : null}
    </div>
  );
}

type GuardrailFollowUpSubmission = {
  entry: {
    id: string;
  };
};

function buildOptimisticEntry(
  entry: GuardrailQueueEntry,
  action: GuardrailFollowUpAction,
  note: string | null,
  attachments: GuardrailAttachment[],
): GuardrailQueueEntry {
  return {
    ...entry,
    action,
    notes: note,
    attachments: attachments.length
      ? attachments.map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          assetUrl: attachment.assetUrl,
          storageKey: attachment.storageKey,
          size: attachment.size,
          contentType: attachment.contentType,
          uploadedAt: attachment.uploadedAt,
        }))
      : entry.attachments,
    createdAt: new Date().toISOString(),
    conversionCursor: entry.conversionCursor ?? null,
    conversionHref: entry.conversionHref ?? entry.providerHref,
  };
}

function getStoredFilter<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const stored = localStorage.getItem(mapFilterKey(key));
    if (!stored) {
      return fallback;
    }
    if (stored === "true" || stored === "false") {
      return (stored === "true") as unknown as T;
    }
    try {
      return JSON.parse(stored) as T;
    } catch {
      return stored as unknown as T;
    }
  } catch {
    return fallback;
  }
}

function mapFilterKey(key: string): string {
  return `guardrailQueue:${key}`;
}

function getInitialQueryValue(param: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  return params.get(param);
}

function parseSeverityQuery(value: string): Record<Exclude<QueueFilter, "all">, boolean> | null {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter((token): token is Exclude<QueueFilter, "all"> => token === "critical" || token === "warning");
  if (!tokens.length) {
    return null;
  }
  return {
    critical: tokens.includes("critical"),
    warning: tokens.includes("warning"),
  };
}

async function logGuardrailFollowUp(
  entry: GuardrailQueueEntry,
  action: GuardrailFollowUpAction,
  note: string | null,
  pendingAttachments: GuardrailAttachment[],
): Promise<GuardrailFollowUpSubmission | null> {
  const payload = {
    providerId: entry.providerId,
    providerName: entry.providerName,
    action,
    notes: note,
    platformContext: entry.platformContext ?? null,
    conversionCursor: entry.conversionCursor ?? null,
    conversionHref: entry.conversionHref ?? entry.providerHref,
    attachments:
      pendingAttachments.length > 0
        ? pendingAttachments.map((attachment) => ({
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
  const response = await fetch("/api/reporting/guardrail-followups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Failed to record follow-up");
  }
  const submission = (await response.json()) as GuardrailFollowUpSubmission | null;
  await trackGuardrailAutomation({
    slug: entry.providerId,
    variantKey: entry.providerName,
    action,
    providerId: entry.providerId,
    tags: {
      platformSlug: entry.platformContext?.id ?? null,
    },
    metadata: {
      note: note ?? null,
      source: "workflow-board",
    },
  });
  return submission;
}

function formatAction(action: GuardrailQueueEntry["action"]): string {
  return actionLabels[action] ?? action;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

async function copyAttachmentLink(
  entry: GuardrailQueueEntry,
  attachment: NonNullable<GuardrailQueueEntry["attachments"]>[number],
  setState: Dispatch<SetStateAction<Record<string, "idle" | "copied">>>,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(attachment.assetUrl);
    setState((prev) => ({ ...prev, [attachment.id]: "copied" }));
    window.setTimeout(() => {
      setState((prev) => ({ ...prev, [attachment.id]: "idle" }));
    }, 1500);
    await trackGuardrailWorkflow({
      workflowAction: "attachment.copy",
      providerId: entry.providerId,
      providerName: entry.providerName,
      metadata: {
        attachmentId: attachment.id,
        attachmentName: attachment.fileName,
      },
    });
  } catch (error) {
    console.warn("Failed to copy attachment link", error);
  }
}

function formatAttachmentMeta(
  attachment: NonNullable<GuardrailQueueEntry["attachments"]>[number],
): string {
  const sizeLabel =
    typeof attachment.size === "number" && Number.isFinite(attachment.size)
      ? `${(attachment.size / 1024).toFixed(1)} KB`
      : "Size unknown";
  const contentType = attachment.contentType ?? "binary";
  return `${sizeLabel} · ${contentType}`;
}
