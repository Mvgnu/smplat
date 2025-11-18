"use client";

import { useFormState, useFormStatus } from "react-dom";
import { AlertTriangle, ArrowRightCircle, ShieldCheck } from "lucide-react";

import { validateSocialAccountAction } from "@/app/(admin)/admin/reports/actions";
import {
  accountValidationInitialState,
  type AccountValidationActionState,
} from "@/lib/admin-report-actions-shared";
import type { MetricValidationResult } from "@/types/metrics";

type MetricSourcingTestbedClientProps = {
  initialState?: AccountValidationActionState;
};

export function MetricSourcingTestbedClient({
  initialState = accountValidationInitialState,
}: MetricSourcingTestbedClientProps) {
  const [state, formAction] = useFormState(validateSocialAccountAction, initialState);

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
      <form action={formAction} className="space-y-5 rounded-2xl border border-white/10 bg-black/30 p-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Account validation</p>
          <h3 className="text-lg font-semibold text-white">Metric sourcer testbed</h3>
          <p className="text-sm text-white/60">
            Validate storefront handles with the FastAPI proxy. Supply manual metrics when the scraper is unavailable.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm text-white/70">
            <span>Platform</span>
            <select
              name="platform"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
              defaultValue="instagram"
            >
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
            </select>
          </label>

          <label className="space-y-2 text-sm text-white/70">
            <span>Handle</span>
            <input
              name="handle"
              placeholder="@acme"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
              required
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm text-white/70">
            <span>Customer profile ID (optional)</span>
            <input
              name="customerProfileId"
              placeholder="uuid"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
            />
          </label>
          <label className="space-y-2 text-sm text-white/70">
            <span>Notes</span>
            <input
              name="metadataNotes"
              placeholder="Manual validation context"
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
            />
          </label>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Manual metrics (optional)</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <NumberField name="manualFollowers" label="Followers" placeholder="12000" />
            <NumberField name="manualFollowing" label="Following" placeholder="480" />
            <NumberField name="manualSampleSize" label="Sample size" placeholder="10" />
            <NumberField name="manualAvgLikes" label="Avg likes" placeholder="540" />
            <NumberField name="manualAvgComments" label="Avg comments" placeholder="48" />
            <NumberField name="manualEngagementRate" label="Engagement %" placeholder="4.2" step="0.1" />
            <label className="md:col-span-3 space-y-2 text-sm text-white/70">
              <span>Last post timestamp</span>
              <input
                type="datetime-local"
                name="manualLastPostAt"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
              />
            </label>
          </div>
        </div>

        <SubmitButton />

        {state.status === "error" && state.message ? (
          <p className="flex items-center gap-2 text-sm text-rose-200">
            <AlertTriangle className="h-4 w-4" />
            {state.message}
          </p>
        ) : null}
      </form>

      <AccountPreviewPanel state={state} />
    </div>
  );
}

function NumberField({
  name,
  label,
  placeholder,
  step,
}: {
  name: string;
  label: string;
  placeholder?: string;
  step?: string;
}) {
  return (
    <label className="space-y-2 text-sm text-white/70">
      <span>{label}</span>
      <input
        type="number"
        name={name}
        placeholder={placeholder}
        step={step}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-white/40 focus:outline-none"
      />
    </label>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="inline-flex items-center gap-2 rounded-full border border-white/30 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:border-white/60 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={pending}
    >
      {pending ? "Validating…" : "Validate account"}
      <ArrowRightCircle className="h-4 w-4" />
    </button>
  );
}

function AccountPreviewPanel({ state }: { state: AccountValidationActionState }) {
  if (state.result == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm text-white/60">
        <ShieldCheck className="mb-3 h-8 w-8 text-white/30" />
        Submit a handle to preview baseline metrics and persisted account metadata.
      </div>
    );
  }
  return <AccountPreviewCard result={state.result} status={state.status} />;
}

type AccountPreviewCardProps = {
  result: MetricValidationResult;
  status: AccountValidationActionState["status"];
};

export function AccountPreviewCard({ result, status }: AccountPreviewCardProps) {
  const { account, snapshot } = result;
  const metricEntries = Object.entries(snapshot.metrics ?? {});

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-black/60 p-5">
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-[0.3em] text-white/40">Latest snapshot</p>
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-semibold text-white">{account.displayName ?? `@${account.handle}`}</h3>
          <span className="rounded-full border border-white/20 px-2 py-0.5 text-xs uppercase tracking-[0.2em] text-white/60">
            {account.platform}
          </span>
        </div>
        <p className="text-sm text-white/60">
          {snapshot.source === "scraper" ? "Scraper" : "Manual"} • Last sync{" "}
          {snapshot.scrapedAt ? new Date(snapshot.scrapedAt).toLocaleString() : "—"}
        </p>
      </div>

      <dl className="grid gap-3 text-sm text-white/80">
        {metricEntries.map(([key, value]) => (
          <div key={key} className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">
            <dt className="text-xs uppercase tracking-[0.3em] text-white/40">{key}</dt>
            <dd className="text-base font-semibold text-white">{String(value ?? "—")}</dd>
          </div>
        ))}
      </dl>

      {snapshot.warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Warnings
          </p>
          <ul className="ml-6 list-disc text-amber-50/80">
            {snapshot.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/70">
        <p className="uppercase tracking-[0.3em] text-white/40">Account metadata</p>
        <pre className="mt-2 max-h-48 overflow-auto text-emerald-100">
          {JSON.stringify(account.metadata, null, 2)}
        </pre>
      </div>

      {status === "success" && (
        <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-emerald-300">
          <ShieldCheck className="h-4 w-4" />
          Snapshot persisted
        </p>
      )}
    </div>
  );
}

export { MetricSourcingTestbedClient as MetricSourcingTestbed };
