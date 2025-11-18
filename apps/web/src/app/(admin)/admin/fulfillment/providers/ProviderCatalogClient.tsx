"use client";

import { useMemo, useState, type ComponentProps } from "react";
import type { MarginStatus, ProviderAutomationTelemetry, RuleOverrideServiceSummary } from "@/lib/provider-service-insights";
import {
  describeCadence,
  describeCostModel,
  describeGuardrails,
  estimateProviderCost,
  evaluateMargin,
  formatCurrency,
  summarizeProviderAutomationTelemetry,
  safePositiveNumber,
} from "@/lib/provider-service-insights";
import { GuardrailFollowUpTimeline } from "@/components/admin/GuardrailFollowUpTimeline";
import { useFormState } from "react-dom";

import type { FulfillmentProvider, FulfillmentProviderOrder, FulfillmentService } from "@/types/fulfillment";
import type { ProviderAutomationStatus, ProviderAutomationHistory } from "@/types/provider-automation";
import type { GuardrailFollowUpEntry } from "@/types/reporting";
import { AutomationStatusPanel } from "@/components/admin/AutomationStatusPanel";
import { ProviderOrderCard } from "./ProviderOrderCard";
import { ActionButton, ActionMessage, DangerButton } from "./components";
import {
  initialActionState,
  createProviderAction,
  updateProviderAction,
  deleteProviderAction,
  createServiceAction,
  updateServiceAction,
  deleteServiceAction,
  refreshProviderBalanceAction,
} from "./actions";

type ProviderCatalogClientProps = {
  providers: FulfillmentProvider[];
  ordersByProvider: Record<string, FulfillmentProviderOrder[]>;
  followUpsByProvider: Record<string, { entries: GuardrailFollowUpEntry[]; nextCursor: string | null }>;
  csrfToken: string;
  automationStatus: ProviderAutomationStatus | null;
  automationHistory: ProviderAutomationHistory | null;
  automationActions?: {
    replay?: (formData: FormData) => Promise<void>;
    alerts?: (formData: FormData) => Promise<void>;
    refreshPath?: string;
  };
};

type EndpointKey = "order" | "balance" | "refill";

const ENDPOINT_FORM_FIELDS: Record<EndpointKey, string> = {
  order: "orderEndpoint",
  balance: "balanceEndpoint",
  refill: "refillEndpoint",
};

const extractEndpointConfig = (metadata: Record<string, unknown>, key: EndpointKey) => {
  const automation = metadata?.automation;
  if (automation && typeof automation === "object" && !Array.isArray(automation)) {
    const endpoints = (automation as Record<string, unknown>).endpoints;
    if (endpoints && typeof endpoints === "object" && !Array.isArray(endpoints)) {
      const config = (endpoints as Record<string, unknown>)[key];
      if (config && typeof config === "object" && !Array.isArray(config)) {
        return config as Record<string, unknown>;
      }
    }
  }
  return null;
};

const stringifyEndpointConfig = (provider: FulfillmentProvider, key: EndpointKey) => {
  const config = extractEndpointConfig(provider.metadata, key);
  return config ? JSON.stringify(config, null, 2) : "";
};

export function ProviderCatalogClient({
  providers,
  ordersByProvider,
  followUpsByProvider,
  csrfToken,
  automationStatus,
  automationHistory,
  automationActions,
}: ProviderCatalogClientProps) {
  return (
    <div className="space-y-8">
      <AutomationStatusPanel
        status={automationStatus}
        history={automationHistory}
        replayAction={automationActions?.replay}
        alertAction={automationActions?.alerts}
        refreshPath={automationActions?.refreshPath ?? "/admin/fulfillment/providers"}
      />
      <section className="rounded-3xl border border-white/10 bg-black/30 p-6">
        <h2 className="text-lg font-semibold text-white">Register new provider</h2>
        <p className="mt-1 text-sm text-white/60">
          Persist a new fulfillment provider, including allowed regions, credentials, and default status.
        </p>
        <div className="mt-4">
          <NewProviderForm csrfToken={csrfToken} />
        </div>
      </section>

      <section className="space-y-4">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-white">Provider catalog</h2>
          <p className="text-sm text-white/60">
            Review persisted providers, update operational status, and manage individual fulfillment services.
          </p>
        </header>

        {providers.length === 0 ? (
          <p className="rounded-3xl border border-white/10 bg-black/30 p-6 text-sm text-white/60">
            No providers have been registered yet.
          </p>
        ) : (
          <div className="space-y-6">
            {providers.map((provider) => (
              <ProviderPanel
                key={provider.id}
                provider={provider}
                orders={ordersByProvider[provider.id] ?? []}
                followUps={followUpsByProvider[provider.id] ?? { entries: [], nextCursor: null }}
                csrfToken={csrfToken}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function NewProviderForm({ csrfToken }: { csrfToken: string }) {
  const [state, formAction] = useFormState(createProviderAction, initialActionState);

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <TextField name="providerId" label="Provider ID" required placeholder="e.g. xyz_network" />
      <TextField name="name" label="Display name" required placeholder="XYZ Growth Network" />
      <TextField name="description" label="Description" className="md:col-span-2" />
      <TextField name="baseUrl" label="Base API URL" placeholder="https://api.provider.example" />
      <TextField
        name="allowedRegions"
        label="Allowed regions"
        placeholder="comma separated (e.g. eu,us-west)"
      />
      <TextField name="rateLimit" label="Rate limit per minute" type="number" min="0" step="1" />
      <SelectField
        name="status"
        label="Status"
        options={[
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
        ]}
        defaultValue="active"
      />
      <SelectField
        name="healthStatus"
        label="Health status"
        options={[
          { label: "Unknown", value: "" },
          { label: "Healthy", value: "healthy" },
          { label: "Degraded", value: "degraded" },
          { label: "Offline", value: "offline" },
        ]}
      />
      <TextField
        name="lastHealthCheckAt"
        label="Last health check"
        type="datetime-local"
        className="md:col-span-2"
      />
      <TextAreaField
        name="metadata"
        label="Metadata (JSON)"
        placeholder='{"supportEmail":"ops@example.com"}'
        className="md:col-span-2"
      />
      <TextAreaField
        name="credentials"
        label="Credentials (JSON)"
        placeholder='{"apiKey":"***"}'
        className="md:col-span-2"
      />
      <TextAreaField
        name="healthPayload"
        label="Health payload (JSON)"
        placeholder='{"endpointLatencyMs":450}'
        className="md:col-span-2"
      />
      <TextAreaField
        name="orderEndpoint"
        label="Order endpoint (JSON)"
        placeholder='{"method":"POST","url":"https://api.provider.example/orders","headers":{"Authorization":"Bearer ..."},"payload":{"amount":"{{amount}}"}}'
        className="md:col-span-2"
      />
      <TextAreaField
        name="balanceEndpoint"
        label="Balance endpoint (JSON)"
        placeholder='{"method":"GET","url":"https://api.provider.example/balance"}'
        className="md:col-span-2"
      />
      <TextAreaField
        name="refillEndpoint"
        label="Refill endpoint (JSON)"
        placeholder='{"method":"POST","url":"https://api.provider.example/refill","payload":{"providerOrderId":"{{providerOrderId}}","amount":"{{amount}}"}}'
        className="md:col-span-2"
      />
      <div className="md:col-span-2 flex items-center gap-4">
        <ActionButton>Create provider</ActionButton>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function ProviderPanel({
  provider,
  csrfToken,
  orders,
  followUps,
}: {
  provider: FulfillmentProvider;
  csrfToken: string;
  orders: FulfillmentProviderOrder[];
  followUps: { entries: GuardrailFollowUpEntry[]; nextCursor: string | null };
}) {
  const [updateState, updateAction] = useFormState(updateProviderAction, initialActionState);
  const [deleteState, deleteAction] = useFormState(deleteProviderAction, initialActionState);
  const allowedRegionsDisplay = useMemo(
    () => provider.allowedRegions.join(", "),
    [provider.allowedRegions],
  );
  const metadataDisplay = useMemo(
    () => (Object.keys(provider.metadata).length ? JSON.stringify(provider.metadata, null, 2) : ""),
    [provider.metadata],
  );
  const credentialsDisplay = useMemo(
    () => (provider.credentials ? JSON.stringify(provider.credentials, null, 2) : ""),
    [provider.credentials],
  );
  const healthPayloadDisplay = useMemo(
    () => (Object.keys(provider.healthPayload).length ? JSON.stringify(provider.healthPayload, null, 2) : ""),
    [provider.healthPayload],
  );
  const orderEndpointDisplay = useMemo(() => stringifyEndpointConfig(provider, "order"), [provider]);
  const balanceEndpointDisplay = useMemo(() => stringifyEndpointConfig(provider, "balance"), [provider]);
  const refillEndpointDisplay = useMemo(() => stringifyEndpointConfig(provider, "refill"), [provider]);

  return (
    <article className="space-y-6 rounded-3xl border border-white/10 bg-black/20 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-white">{provider.name}</h3>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">{provider.id}</p>
        </div>
        <StatusBadges status={provider.status} healthStatus={provider.healthStatus} />
      </header>

      <ProviderWalletPanel provider={provider} csrfToken={csrfToken} />

      <ProviderOrdersSection providerId={provider.id} orders={orders} csrfToken={csrfToken} />
      <GuardrailFollowUpTimeline
        providerId={provider.id}
        title="Guardrail follow-ups"
        initialEntries={followUps.entries}
        initialNextCursor={followUps.nextCursor}
        emptyState={`No guardrail follow-ups have been logged for ${provider.id}.`}
        defaultOpen={followUps.entries.length > 0}
      />

      <section className="space-y-4">
        <h4 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Provider settings</h4>
        <form action={updateAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="providerId" value={provider.id} />
          <TextField name="name" label="Display name" defaultValue={provider.name} required />
          <TextField
            name="baseUrl"
            label="Base API URL"
            defaultValue={provider.baseUrl ?? ""}
            placeholder="https://api.provider.example"
          />
          <TextField
            name="description"
            label="Description"
            defaultValue={provider.description ?? ""}
            className="md:col-span-2"
          />
          <TextField
            name="allowedRegions"
            label="Allowed regions"
            defaultValue={allowedRegionsDisplay}
            placeholder="comma separated"
          />
          <TextField
            name="rateLimit"
            label="Rate limit per minute"
            defaultValue={provider.rateLimitPerMinute?.toString() ?? ""}
            type="number"
            min="0"
            step="1"
          />
          <SelectField
            name="status"
            label="Status"
            defaultValue={provider.status}
            options={[
              { label: "Active", value: "active" },
              { label: "Inactive", value: "inactive" },
            ]}
          />
          <SelectField
            name="healthStatus"
            label="Health status"
            defaultValue={provider.healthStatus}
            options={[
              { label: "Unknown", value: "unknown" },
              { label: "Healthy", value: "healthy" },
              { label: "Degraded", value: "degraded" },
              { label: "Offline", value: "offline" },
            ]}
          />
          <TextField
            name="lastHealthCheckAt"
            label="Last health check"
            type="datetime-local"
            defaultValue={provider.lastHealthCheckAt ? provider.lastHealthCheckAt.slice(0, 16) : ""}
          />
          <TextAreaField
            name="metadata"
            label="Metadata (JSON)"
            defaultValue={metadataDisplay}
            className="md:col-span-2"
          />
          <TextAreaField
            name="credentials"
            label="Credentials (JSON)"
            defaultValue={credentialsDisplay}
            className="md:col-span-2"
          />
          <TextAreaField
            name="healthPayload"
            label="Health payload (JSON)"
            defaultValue={healthPayloadDisplay}
            className="md:col-span-2"
          />
          <TextAreaField
            name="orderEndpoint"
            label="Order endpoint (JSON)"
            defaultValue={orderEndpointDisplay}
            className="md:col-span-2"
          />
          <TextAreaField
            name="balanceEndpoint"
            label="Balance endpoint (JSON)"
            defaultValue={balanceEndpointDisplay}
            className="md:col-span-2"
          />
          <TextAreaField
            name="refillEndpoint"
            label="Refill endpoint (JSON)"
            defaultValue={refillEndpointDisplay}
            className="md:col-span-2"
          />
          <div className="md:col-span-2 flex items-center gap-4">
            <ActionButton>Save provider</ActionButton>
            <ActionMessage state={updateState} />
          </div>
        </form>

        <form action={deleteAction} className="flex items-center gap-3">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="providerId" value={provider.id} />
          <DangerButton>Delete provider</DangerButton>
          <ActionMessage state={deleteState} />
        </form>
      </section>

      <section className="space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">Services</h4>
          <span className="text-xs uppercase tracking-[0.3em] text-white/40">
            {provider.services.length} registered
          </span>
        </header>

        <ServiceCreateForm providerId={provider.id} csrfToken={csrfToken} />

        {provider.services.length > 0 ? (
          <div className="space-y-4">
            {provider.services.map((service) => (
              <ServiceCard
                key={service.id}
                providerId={provider.id}
                service={service}
                csrfToken={csrfToken}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white/60">
            No services registered for this provider.
          </p>
        )}
      </section>
    </article>
  );
}

function ServiceCreateForm({ providerId, csrfToken }: { providerId: string; csrfToken: string }) {
  const [state, formAction] = useFormState(createServiceAction, initialActionState);

  return (
    <form action={formAction} className="grid gap-3 rounded-2xl border border-white/10 bg-black/30 p-4 md:grid-cols-2">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <input type="hidden" name="providerId" value={providerId} />
      <h5 className="md:col-span-2 text-sm font-semibold text-white">Add new service</h5>
      <TextField name="serviceId" label="Service ID" required placeholder="e.g. svc_followers_global" />
      <TextField name="name" label="Service name" required placeholder="Follower Growth · EU" />
      <TextField name="action" label="Action key" required placeholder="followers_eu_standard" />
      <TextField name="category" label="Category" placeholder="followers" />
      <TextField name="defaultCurrency" label="Default currency" placeholder="EUR" maxLength={3} />
      <TextField
        name="allowedRegions"
        label="Allowed regions"
        placeholder="comma separated"
        className="md:col-span-2"
      />
      <TextField name="rateLimit" label="Rate limit per minute" type="number" min="0" step="1" />
      <SelectField
        name="status"
        label="Status"
        defaultValue="active"
        options={[
          { label: "Active", value: "active" },
          { label: "Inactive", value: "inactive" },
        ]}
      />
      <SelectField
        name="healthStatus"
        label="Health status"
        options={[
          { label: "Unknown", value: "" },
          { label: "Healthy", value: "healthy" },
          { label: "Degraded", value: "degraded" },
          { label: "Offline", value: "offline" },
        ]}
      />
      <TextField name="lastHealthCheckAt" label="Last health check" type="datetime-local" />
      <TextAreaField name="metadata" label="Metadata (JSON)" className="md:col-span-2" />
      <TextAreaField name="credentials" label="Credentials (JSON)" className="md:col-span-2" />
      <TextAreaField name="healthPayload" label="Health payload (JSON)" className="md:col-span-2" />
      <div className="md:col-span-2 flex items-center gap-4">
        <ActionButton>Add service</ActionButton>
        <ActionMessage state={state} />
      </div>
    </form>
  );
}

function ProviderWalletPanel({ provider, csrfToken }: { provider: FulfillmentProvider; csrfToken: string }) {
  const [state, formAction] = useFormState(refreshProviderBalanceAction, initialActionState);
  const snapshot = provider.balanceSnapshot ?? null;
  const payloadDisplay =
    snapshot?.payload && Object.keys(snapshot.payload).length > 0 ? JSON.stringify(snapshot.payload, null, 2) : null;

  return (
    <section className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Provider wallet</p>
          {snapshot ? (
            <p className="text-lg font-semibold text-white">
              {snapshot.currency ?? ""} {snapshot.amount ?? "—"}
            </p>
          ) : (
            <p className="text-sm text-white/60">No balance snapshot captured yet.</p>
          )}
          {snapshot?.retrievedAt ? (
            <p className="text-xs text-white/50">Checked {new Date(snapshot.retrievedAt).toLocaleString()}</p>
          ) : null}
        </div>
        <form action={formAction} className="flex items-center gap-3">
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="providerId" value={provider.id} />
          <ActionButton>Refresh balance</ActionButton>
          <ActionMessage state={state} />
        </form>
      </div>
      {payloadDisplay ? (
        <details className="rounded-xl border border-white/5 bg-black/40">
          <summary className="cursor-pointer px-4 py-2 text-sm text-white/70">Raw payload</summary>
          <pre className="max-h-60 overflow-auto px-4 py-2 text-xs text-white/60">{payloadDisplay}</pre>
        </details>
      ) : (
        <p className="text-xs text-white/50">Awaiting automation payload. Configure balance endpoint to hydrate.</p>
      )}
    </section>
  );
}

function ProviderOrdersSection({
  providerId,
  orders,
  csrfToken,
}: {
  providerId: string;
  orders: FulfillmentProviderOrder[];
  csrfToken: string;
}) {
  const telemetry = useMemo(() => summarizeProviderAutomationTelemetry(orders), [orders]);
  const visibleOrders = useMemo(() => orders.slice(0, 8), [orders]);
  const hasTelemetry =
    telemetry.totalOrders > 0 ||
    telemetry.replays.total > 0 ||
    telemetry.replays.scheduled > 0 ||
    telemetry.guardrails.evaluated > 0;
  return (
    <section className="space-y-4 rounded-2xl border border-white/10 bg-black/30 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Provider orders</p>
          <p className="text-sm text-white/60">Track downstream engagements and issue refills.</p>
        </div>
        <span className="text-xs uppercase tracking-[0.3em] text-white/40">
          {visibleOrders.length} shown · {orders.length} tracked
        </span>
      </header>
      {hasTelemetry ? <ProviderAutomationTelemetryPanel telemetry={telemetry} /> : null}
      {visibleOrders.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-black/40 p-4 text-sm text-white/60">
          No provider orders recorded yet. Service overrides will populate this log after checkout.
        </p>
      ) : (
        <div className="space-y-3">
          {visibleOrders.map((order) => (
            <ProviderOrderCard key={order.id} providerId={providerId} order={order} csrfToken={csrfToken} />
          ))}
          {orders.length > visibleOrders.length ? (
            <p className="text-center text-[0.65rem] uppercase tracking-[0.3em] text-white/40">
              Showing latest {visibleOrders.length} of {orders.length} provider orders.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

type ProviderFollowUpTimelineProps = {
  providerId: string;
  entries: GuardrailFollowUpEntry[];
};


function ProviderAutomationTelemetryPanel({ telemetry }: { telemetry: ProviderAutomationTelemetry }) {
  const overrideTotal = countRuleOverrides(telemetry.ruleOverridesByService);
  const summaryStats = [
    { label: "Tracked orders", value: telemetry.totalOrders },
    { label: "Replays executed", value: telemetry.replays.executed },
    { label: "Replays failed", value: telemetry.replays.failed },
    { label: "Scheduled pending", value: telemetry.replays.scheduled },
    { label: "Rule overrides", value: overrideTotal },
  ];
  const guardrailStats: Array<{ label: string; value: number; status: MarginStatus }> = [
    { label: "Guardrail failures", value: telemetry.guardrails.fail, status: "fail" },
    { label: "Guardrail warnings", value: telemetry.guardrails.warn, status: "warn" },
    { label: "Guardrail passes", value: telemetry.guardrails.pass, status: "pass" },
  ];
  const serviceEntries = Object.entries(telemetry.guardrailHitsByService);

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-black/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {summaryStats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{stat.value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {guardrailStats.map((stat) => {
          const tone = getMarginStatusStyle(stat.status);
          return (
            <div key={stat.label} className={`rounded-lg border bg-black/20 p-3 ${tone.border}`}>
              <p className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">{stat.label}</p>
              <p className={`mt-2 text-xl font-semibold ${tone.text}`}>{stat.value}</p>
            </div>
          );
        })}
      </div>
      {serviceEntries.length ? (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Guardrail posture per service</p>
          <div className="grid gap-2 md:grid-cols-2">
            {serviceEntries.map(([serviceId, stats]) => (
              <div key={serviceId} className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-white">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{serviceId}</span>
                  <span className="text-[0.6rem] uppercase tracking-[0.3em] text-white/40">
                    {stats.evaluated} evals
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["fail", "warn", "pass"] as const).map((status) =>
                    stats[status] ? (
                      <span
                        key={`${serviceId}-${status}`}
                        className={`rounded-full border px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.3em] ${getMarginStatusStyle(status).border} ${getMarginStatusStyle(status).text}`}
                      >
                        {getMarginStatusStyle(status).label}: {stats[status]}
                      </span>
                    ) : null,
                  )}
                </div>
                {renderOverrideSummary(telemetry.ruleOverridesByService[serviceId])}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function countRuleOverrides(map: ProviderAutomationTelemetry["ruleOverridesByService"]): number {
  return Object.values(map ?? {}).reduce((total, entry) => total + entry.totalOverrides, 0);
}

function renderOverrideSummary(summary: RuleOverrideServiceSummary | undefined) {
  if (!summary) {
    return <p className="text-xs text-white/50">No rule overrides recorded</p>;
  }
  const topRule = resolveOverrideTopRule(summary);
  return (
    <p className="text-xs text-white/60">
      {summary.totalOverrides} overrides{topRule ? ` · top ${topRule.label ?? topRule.id}` : ""}
    </p>
  );
}

function resolveOverrideTopRule(summary: RuleOverrideServiceSummary | undefined) {
  if (!summary) {
    return null;
  }
  const rules = Object.values(summary.rules ?? {});
  if (!rules.length) {
    return null;
  }
  return [...rules].sort((a, b) => b.count - a.count)[0] ?? null;
}

function ServiceCard({
  providerId,
  service,
  csrfToken,
}: {
  providerId: string;
  service: FulfillmentService;
  csrfToken: string;
}) {
  const [updateState, updateAction] = useFormState(updateServiceAction, initialActionState);
  const [deleteState, deleteAction] = useFormState(deleteServiceAction, initialActionState);
  const allowedRegionsDisplay = useMemo(
    () => service.allowedRegions.join(", "),
    [service.allowedRegions],
  );
  const metadataDisplay = useMemo(() => {
    const payload = metadataToEditorPayload(service.metadata);
    return Object.keys(payload).length ? JSON.stringify(payload, null, 2) : "";
  }, [service.metadata]);
  const credentialsDisplay = useMemo(
    () => (service.credentials ? JSON.stringify(service.credentials, null, 2) : ""),
    [service.credentials],
  );
  const healthPayloadDisplay = useMemo(
    () => (Object.keys(service.healthPayload).length ? JSON.stringify(service.healthPayload, null, 2) : ""),
    [service.healthPayload],
  );

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/25 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h5 className="text-sm font-semibold text-white">{service.name}</h5>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">{service.id}</p>
        </div>
        <StatusBadges status={service.status} healthStatus={service.healthStatus} />
      </header>

      <ServiceCostInsights service={service} />

      <form action={updateAction} className="grid gap-3 md:grid-cols-2">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="providerId" value={providerId} />
        <input type="hidden" name="serviceId" value={service.id} />
        <TextField name="name" label="Service name" defaultValue={service.name} required />
        <TextField name="action" label="Action key" defaultValue={service.action} required />
        <TextField name="category" label="Category" defaultValue={service.category ?? ""} />
        <TextField
          name="defaultCurrency"
          label="Default currency"
          defaultValue={service.defaultCurrency ?? ""}
          maxLength={3}
        />
        <TextField
          name="allowedRegions"
          label="Allowed regions"
          defaultValue={allowedRegionsDisplay}
          className="md:col-span-2"
        />
        <TextField
          name="rateLimit"
          label="Rate limit per minute"
          type="number"
          min="0"
          step="1"
          defaultValue={service.rateLimitPerMinute?.toString() ?? ""}
        />
        <SelectField
          name="status"
          label="Status"
          defaultValue={service.status}
          options={[
            { label: "Active", value: "active" },
            { label: "Inactive", value: "inactive" },
          ]}
        />
        <SelectField
          name="healthStatus"
          label="Health status"
          defaultValue={service.healthStatus}
          options={[
            { label: "Unknown", value: "unknown" },
            { label: "Healthy", value: "healthy" },
            { label: "Degraded", value: "degraded" },
            { label: "Offline", value: "offline" },
          ]}
        />
        <TextField
          name="lastHealthCheckAt"
          label="Last health check"
          type="datetime-local"
          defaultValue={service.lastHealthCheckAt ? service.lastHealthCheckAt.slice(0, 16) : ""}
        />
        <TextAreaField name="metadata" label="Metadata (JSON)" defaultValue={metadataDisplay} className="md:col-span-2" />
        <TextAreaField
          name="credentials"
          label="Credentials (JSON)"
          defaultValue={credentialsDisplay}
          className="md:col-span-2"
        />
        <TextAreaField
          name="healthPayload"
          label="Health payload (JSON)"
          defaultValue={healthPayloadDisplay}
          className="md:col-span-2"
        />
        <div className="md:col-span-2 flex items-center gap-4">
          <ActionButton>Save service</ActionButton>
          <ActionMessage state={updateState} />
        </div>
      </form>

      <form action={deleteAction} className="flex items-center gap-3">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        <input type="hidden" name="providerId" value={providerId} />
        <input type="hidden" name="serviceId" value={service.id} />
        <DangerButton>Delete service</DangerButton>
        <ActionMessage state={deleteState} />
      </form>
    </div>
  );
}

function ServiceCostInsights({ service }: { service: FulfillmentService }) {
  const hasStructuredMetadata =
    Boolean(service.metadata.costModel) || Boolean(service.metadata.guardrails) || Boolean(service.metadata.cadence);
  const preferredCurrency =
    service.metadata.costModel?.currency ??
    service.metadata.guardrails?.currency ??
    service.defaultCurrency ??
    "USD";
  const derivedQuantity =
    typeof service.metadata.defaultInputs?.quantity === "number" && service.metadata.defaultInputs.quantity > 0
      ? service.metadata.defaultInputs.quantity
      : 1;
  const [quantityInput, setQuantityInput] = useState(String(derivedQuantity));
  const [priceInput, setPriceInput] = useState("");

  const quantity = safePositiveNumber(quantityInput) ?? derivedQuantity;
  const customerPrice = safePositiveNumber(priceInput);
  const providerCost = estimateProviderCost(service.metadata.costModel, quantity);
  const margin = evaluateMargin(service.metadata.guardrails, providerCost, customerPrice);
  const statusStyle = getMarginStatusStyle(margin.status);

  const costSummary = useMemo(
    () => describeCostModel(service.metadata.costModel, preferredCurrency),
    [service.metadata.costModel, preferredCurrency],
  );
  const cadenceSummary = useMemo(
    () => describeCadence(service.metadata.cadence),
    [service.metadata.cadence],
  );
  const guardrailSummary = useMemo(
    () => describeGuardrails(service.metadata.guardrails, preferredCurrency),
    [service.metadata.guardrails, preferredCurrency],
  );
  const payloadSummary = useMemo(() => {
    if (!service.metadata.payloadTemplates?.length) {
      return null;
    }
    const operations = Array.from(new Set(service.metadata.payloadTemplates.map((tpl) => tpl.operation))).join(", ");
    return `Payload templates: ${operations}`;
  }, [service.metadata.payloadTemplates]);

  if (!hasStructuredMetadata) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-2xl border border-white/5 bg-black/30 p-3 text-sm text-white/80">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">Cost structure</p>
          {costSummary.length ? (
            <ul className="mt-1 space-y-1 text-white">
              {costSummary.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-white/50">
              Define a structured cost model inside metadata to surface auto-computed margins.
            </p>
          )}
        </div>
        <div className="space-y-2">
          {cadenceSummary.length ? (
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Cadence</p>
              <ul className="mt-1 space-y-1 text-white">
                {cadenceSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {guardrailSummary.length ? (
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-white/40">Guardrails</p>
              <ul className="mt-1 space-y-1 text-white">
                {guardrailSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {payloadSummary ? <p className="text-xs text-white/60">{payloadSummary}</p> : null}
        </div>
      </div>

      {service.metadata.costModel ? (
        <div className="grid gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,1.1fr)]">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.3em] text-white/40">Preview quantity</span>
            <input
              type="number"
              min="0"
              step="1"
              value={quantityInput}
              onChange={(event) => setQuantityInput(event.target.value)}
              className="rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-white focus:border-emerald-400/60 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.3em] text-white/40">Customer price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={priceInput}
              onChange={(event) => setPriceInput(event.target.value)}
              placeholder="Enter list price"
              className="rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-white placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none"
            />
          </label>
          <div
            className={`rounded-2xl border px-4 py-2 ${statusStyle.border} bg-black/40 text-white`}
          >
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">Margin preview</p>
            <p className="text-sm text-white">
              Provider cost:{" "}
              {providerCost != null ? formatCurrency(providerCost, preferredCurrency) : "—"}
            </p>
            <p className={`text-xs ${statusStyle.text}`}>
              {margin.status === "idle"
                ? "Enter a customer price to evaluate guardrails."
                : `${formatCurrency(margin.marginValue ?? 0, preferredCurrency)} margin (${margin.marginPercent?.toFixed(1) ?? "0.0"}%) · ${statusStyle.label}`}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TextField({ name, label, className, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className={`flex flex-col gap-1 text-sm text-white/80 ${className ?? ""}`}>
      <span className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</span>
      <input
        {...props}
        name={name}
        className="rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none"
      />
    </label>
  );
}

function TextAreaField({ name, label, className, ...props }: ComponentProps<"textarea"> & { label: string }) {
  return (
    <label className={`flex flex-col gap-1 text-sm text-white/80 ${className ?? ""}`}>
      <span className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</span>
      <textarea
        {...props}
        name={name}
        rows={props.rows ?? 4}
        className="rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none"
      />
    </label>
  );
}

function SelectField({
  name,
  label,
  options,
  className,
  ...props
}: ComponentProps<"select"> & {
  label: string;
  options: Array<{ label: string; value: string }>;
}) {
  return (
    <label className={`flex flex-col gap-1 text-sm text-white/80 ${className ?? ""}`}>
      <span className="text-xs uppercase tracking-[0.3em] text-white/40">{label}</span>
      <select
        {...props}
        name={name}
        className="rounded-xl border border-white/20 bg-black/40 px-3 py-2 text-sm text-white focus:border-emerald-400/60 focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusBadges({
  status,
  healthStatus,
}: {
  status: FulfillmentProvider["status"] | FulfillmentService["status"];
  healthStatus: FulfillmentProvider["healthStatus"] | FulfillmentService["healthStatus"];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex items-center rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60">
        {status}
      </span>
      <span className="inline-flex items-center rounded-full border border-white/15 px-3 py-1 text-xs uppercase tracking-[0.3em] text-white/60">
        {healthStatus}
      </span>
    </div>
  );
}

function getMarginStatusStyle(status: MarginStatus) {
  switch (status) {
    case "pass":
      return { border: "border-emerald-400/40", text: "text-emerald-300", label: "Healthy" };
    case "warn":
      return { border: "border-amber-400/40", text: "text-amber-300", label: "Warning" };
    case "fail":
      return { border: "border-rose-400/40", text: "text-rose-300", label: "Below guardrails" };
    default:
      return { border: "border-white/15", text: "text-white/60", label: "Pending input" };
  }
}

function metadataToEditorPayload(metadata: FulfillmentService["metadata"]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (metadata.version && metadata.version !== 1) {
    payload.version = metadata.version;
  }
  if (metadata.costModel) {
    payload.costModel = metadata.costModel;
  }
  if (metadata.cadence) {
    payload.cadence = metadata.cadence;
  }
  if (metadata.configuration) {
    payload.configuration = metadata.configuration;
  }
  if (metadata.guardrails) {
    payload.guardrails = metadata.guardrails;
  }
  if (metadata.payloadTemplates?.length) {
    payload.payloadTemplates = metadata.payloadTemplates;
  }
  if (metadata.defaultInputs) {
    payload.defaultInputs = metadata.defaultInputs;
  }
  if (metadata.legacy) {
    payload.legacy = metadata.legacy;
  }
  return payload;
}
