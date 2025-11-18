"use client";

import { useMemo } from "react";
import { useFormState } from "react-dom";
import type { ServiceOverrideRule } from "@smplat/types";

import type {
  FulfillmentProviderOrder,
  FulfillmentProviderOrderReplayEntry,
} from "@/types/fulfillment";
import { describeRuleConditions, describeRuleOverrides } from "@/lib/provider-rule-descriptions";
import {
  buildReplayRuleMetadata,
  computeProviderOrderMarginInsight,
  type ProviderOrderMarginInsight,
  type MarginStatus,
} from "@/lib/provider-service-insights";

import {
  initialActionState,
  replayProviderOrderAction,
  triggerProviderRefillAction,
} from "./actions";
import { ActionButton, ActionMessage } from "./components";

const REPLAY_STATUS_TONE: Record<FulfillmentProviderOrderReplayEntry["status"], string> = {
  executed: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
  scheduled: "border-sky-400/30 bg-sky-500/10 text-sky-100",
  failed: "border-rose-400/30 bg-rose-500/10 text-rose-100",
};

const formatDateTimeLocalInput = (date: Date): string => {
  const pad = (value: number) => value.toString().padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export function ProviderOrderCard({
  providerId,
  order,
  csrfToken,
}: {
  providerId: string;
  order: FulfillmentProviderOrder;
  csrfToken: string;
}) {
  const [refillState, refillAction] = useFormState(triggerProviderRefillAction, initialActionState);
  const [replayState, replayAction] = useFormState(replayProviderOrderAction, initialActionState);
  const [scheduleState, scheduleAction] = useFormState(replayProviderOrderAction, initialActionState);
  const payloadDisplay =
    order.payload && Object.keys(order.payload).length > 0 ? JSON.stringify(order.payload, null, 2) : null;
  const latestRefill = order.refills.at(-1) ?? null;
  const serviceRules = Array.isArray(order.payload?.serviceRules)
    ? (order.payload?.serviceRules as ServiceOverrideRule[])
    : [];
  const defaultScheduleTime = useMemo(() => formatDateTimeLocalInput(new Date(Date.now() + 30 * 60 * 1000)), []);
  const scheduleMinValue = useMemo(() => formatDateTimeLocalInput(new Date()), []);
  const marginInsight = useMemo(() => computeProviderOrderMarginInsight(order), [order]);

  return (
    <article className="space-y-3 rounded-xl border border-white/10 bg-black/40 p-4" data-testid="provider-order-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-white">Provider order {order.providerOrderId ?? "—"}</p>
          <p className="text-xs text-white/50">Order #{order.orderId.slice(0, 8)} · Service {order.serviceId}</p>
        </div>
        <div className="text-right text-sm text-white">
          <p className="font-semibold">
            {order.currency ?? ""} {typeof order.amount === "number" ? order.amount.toFixed(2) : "—"}
          </p>
          <p className="text-xs text-white/50">Last updated {new Date(order.updatedAt).toLocaleString()}</p>
        </div>
      </div>
      <MarginInsightBanner margin={marginInsight} currency={order.currency} />

      <form
        action={refillAction}
        className="grid gap-3 rounded-xl border border-white/5 bg-black/50 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
      >
        <div className="grid gap-2 text-xs text-white/70 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            Provider amount
            <input
              type="number"
              name="amount"
              min="0"
              step="0.01"
              defaultValue={order.amount != null ? String(order.amount) : ""}
              className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
            />
          </label>
          <div className="flex flex-col gap-1">
            <span>Refill state</span>
            {latestRefill ? (
              <span className="text-white">
                {latestRefill.currency ?? order.currency ?? ""} {latestRefill.amount ?? "—"} ·{" "}
                <span className="text-white/60">{new Date(latestRefill.performedAt).toLocaleString()}</span>
              </span>
            ) : (
              <span className="text-white/50">No manual refills yet.</span>
            )}
          </div>
          <label className="md:col-span-2 flex flex-col gap-1">
            Timeline note
            <textarea
              name="note"
              maxLength={500}
              placeholder="Why is this refill needed? This message is stored on the order timeline."
              className="min-h-[72px] rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
            />
          </label>
        </div>
        <div className="flex flex-col items-end gap-2">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="providerId" value={providerId} />
          <input type="hidden" name="providerOrderId" value={order.id} />
          <ActionButton>Trigger refill</ActionButton>
          <ActionMessage state={refillState} />
        </div>
      </form>

      <section className="space-y-3 rounded-xl border border-white/5 bg-black/50 p-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Automation replays</p>
          <p className="text-xs text-white/60">Run the provider endpoint immediately or schedule it for later.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <form action={replayAction} className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">Replay now</p>
            <label className="flex flex-col gap-1 text-xs text-white/70">
              Amount override
              <input
                type="number"
                name="amount"
                min="0"
                step="0.01"
                placeholder="Use recorded amount"
                className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
              />
            </label>
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="providerId" value={providerId} />
            <input type="hidden" name="providerOrderId" value={order.id} />
            <input type="hidden" name="mode" value="execute" />
            <ActionButton>Replay provider order</ActionButton>
            <ActionMessage state={replayState} />
          </form>
          <form action={scheduleAction} className="space-y-2 rounded-lg border border-white/10 bg-black/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-white/60">Schedule replay</p>
            <label className="flex flex-col gap-1 text-xs text-white/70">
              Amount override
              <input
                type="number"
                name="amount"
                min="0"
                step="0.01"
                placeholder="Use recorded amount"
                className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-white/70">
              Run at
              <input
                type="datetime-local"
                name="runAt"
                min={scheduleMinValue}
                defaultValue={defaultScheduleTime}
                required
                className="rounded-lg border border-white/10 bg-black/60 px-3 py-1.5 text-white focus:border-white/40 focus:outline-none"
              />
            </label>
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="providerId" value={providerId} />
            <input type="hidden" name="providerOrderId" value={order.id} />
            <input type="hidden" name="mode" value="schedule" />
            <ActionButton>Queue replay</ActionButton>
            <ActionMessage state={scheduleState} />
          </form>
        </div>
        <div className="space-y-3 text-xs text-white/60">
          <ReplayEntryList title="Scheduled replays" entries={order.scheduledReplays} currency={order.currency} />
          <ReplayEntryList title="Replay history" entries={order.replays} currency={order.currency} />
          {order.replays.length === 0 && order.scheduledReplays.length === 0 ? (
            <p>No replay attempts recorded for this provider order yet.</p>
          ) : null}
        </div>
      </section>

      {order.refills.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-white/5 bg-black/40 p-3">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Refill history</p>
          <ul className="space-y-1 text-xs text-white/70">
            {order.refills.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {entry.currency ?? order.currency ?? ""} {entry.amount ?? "—"}
                </span>
                <span className="text-white/50">{new Date(entry.performedAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {serviceRules.length > 0 ? <ServiceRuleList rules={serviceRules} /> : null}

      {payloadDisplay ? (
        <details className="rounded-xl border border-white/5 bg-black/40">
          <summary className="cursor-pointer px-4 py-2 text-sm text-white/70">Order payload</summary>
          <pre className="max-h-60 overflow-auto px-4 py-2 text-xs text-white/60">{payloadDisplay}</pre>
        </details>
      ) : null}
    </article>
  );
}

function MarginInsightBanner({
  margin,
  currency,
}: {
  margin: ProviderOrderMarginInsight;
  currency?: string | null;
}) {
  if (!margin.guardrails || margin.status === "idle") {
    return null;
  }
  const tone = getMarginInsightTone(margin.status);
  const percentLabel =
    typeof margin.marginPercent === "number" ? `${margin.marginPercent.toFixed(1)}% margin` : "Margin pending";
  const providerCostLabel = formatMoney(margin.providerCost, currency);
  const customerPriceLabel = formatMoney(margin.customerPrice, currency);
  const thresholdLabel = describeGuardrailTargets(margin.guardrails, currency);
  const needsAttention = margin.status === "warn" || margin.status === "fail";

  return (
    <div className={`rounded-xl border px-4 py-3 text-xs ${tone.border} ${tone.bg}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-[0.6rem] uppercase tracking-[0.3em] ${tone.text}`}>{tone.label}</span>
        <span className="text-white/70">{percentLabel}</span>
      </div>
      <p className="mt-1 text-white/60">
        Provider cost {providerCostLabel} vs price {customerPriceLabel}
      </p>
      {thresholdLabel ? <p className="text-white/40">Guardrails: {thresholdLabel}</p> : null}
      {needsAttention ? (
        <p className="mt-1 text-rose-200">
          {margin.status === "fail" ? "Below configured guardrails" : "Approaching guardrails"} — review overrides or
          schedule a replay.
        </p>
      ) : null}
    </div>
  );
}

function ReplayEntryList({
  title,
  entries,
  currency,
}: {
  title: string;
  entries: FulfillmentProviderOrderReplayEntry[];
  currency?: string | null;
}) {
  if (!entries.length) {
    return null;
  }
  return (
    <div className="space-y-2 rounded-xl border border-white/5 bg-black/40 p-3">
      <p className="text-xs uppercase tracking-[0.3em] text-white/40">{title}</p>
      <ul className="space-y-2">
        {entries.map((entry) => {
          const timestamp = entry.performedAt ?? entry.scheduledFor ?? null;
          const responsePayload =
            entry.response && Object.keys(entry.response).length ? JSON.stringify(entry.response, null, 2) : null;
          const rules = buildReplayRuleMetadata(entry);
          return (
            <li key={entry.id} className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/70">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.3em] ${REPLAY_STATUS_TONE[entry.status]}`}
                >
                  {entry.status}
                </span>
                {timestamp ? <span className="text-white/50">{new Date(timestamp).toLocaleString()}</span> : null}
              </div>
              {rules.length ? (
                <div className="flex flex-wrap gap-1">
                  {rules.map((rule) => (
                    <span
                      key={`${entry.id}-rule-${rule.id}`}
                      className="rounded-full border border-emerald-400/30 px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.3em] text-emerald-200/80"
                      title={`Conditions: ${describeRuleConditions(rule)}\nOverrides: ${describeRuleOverrides(rule)}`}
                    >
                      {rule.label ?? rule.id}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="text-sm text-white">
                {entry.currency ?? currency ?? ""} {entry.requestedAmount ?? "—"}
              </div>
              {entry.response?.error ? (
                <p className="text-xs text-rose-300">Error: {String(entry.response.error)}</p>
              ) : responsePayload ? (
                <details>
                  <summary className="cursor-pointer text-white/60">Provider response</summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded border border-white/10 bg-black/30 p-2 text-[0.65rem] text-white/60">
                    {responsePayload}
                  </pre>
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ServiceRuleList({ rules }: { rules: ServiceOverrideRule[] }) {
  if (!rules.length) {
    return null;
  }
  return (
    <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <p className="text-[0.6rem] uppercase tracking-[0.3em] text-emerald-200/80">Provider rules</p>
      <ul className="space-y-2 text-xs text-emerald-50">
        {rules.map((rule) => (
          <li key={rule.id} className="space-y-1 rounded border border-emerald-400/20 bg-black/20 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-emerald-100">{rule.label ?? rule.id}</span>
              {rule.priority != null ? (
                <span className="text-[0.6rem] uppercase tracking-[0.3em] text-emerald-200/70">Priority {rule.priority}</span>
              ) : null}
            </div>
            <p className="text-emerald-100/80">Conditions: {describeRuleConditions(rule)}</p>
            <p className="text-emerald-100/60">Overrides: {describeRuleOverrides(rule)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function getMarginInsightTone(status: MarginStatus) {
  switch (status) {
    case "fail":
      return { border: "border-rose-400/50", bg: "bg-rose-500/10", text: "text-rose-100", label: "Margin breach" };
    case "warn":
      return { border: "border-amber-400/50", bg: "bg-amber-500/10", text: "text-amber-100", label: "Margin warning" };
    case "pass":
      return { border: "border-emerald-400/40", bg: "bg-emerald-500/10", text: "text-emerald-100", label: "Healthy margin" };
    default:
      return { border: "border-white/20", bg: "bg-black/30", text: "text-white/70", label: "Margin pending" };
  }
}

function describeGuardrailTargets(
  guardrails: ProviderOrderMarginInsight["guardrails"],
  currency?: string | null,
): string {
  if (!guardrails) {
    return "";
  }
  const parts: string[] = [];
  if (typeof guardrails.minimumMarginPercent === "number") {
    parts.push(`${guardrails.minimumMarginPercent.toFixed(1)}% min`);
  }
  if (typeof guardrails.minimumMarginAbsolute === "number") {
    parts.push(`${formatMoney(guardrails.minimumMarginAbsolute, currency)} floor`);
  }
  if (!parts.length && typeof guardrails.warningMarginPercent === "number") {
    parts.push(`${guardrails.warningMarginPercent.toFixed(1)}% warn`);
  }
  return parts.join(" · ");
}

function formatMoney(value: number | null | undefined, currency?: string | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return formatter.format(value);
}
