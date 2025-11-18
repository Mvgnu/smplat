"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { GuardrailFollowUpTimeline } from "./GuardrailFollowUpTimeline";
import type { ProviderAutomationTelemetry } from "@/lib/provider-service-insights";
import type { GuardrailFollowUpFeed, GuardrailFollowUpStatus, GuardrailWorkflowTelemetrySummary } from "@/types/reporting";
import { QuickOrderWorkflowTelemetry } from "@/components/account/QuickOrderWorkflowTelemetry.client";

export type ProviderAutomationDrawerOrderItem = {
  orderItemId: string;
  orderItemLabel: string | null;
};

export type ProviderAutomationDrawerEntry = {
  providerId: string;
  providerName?: string | null;
  orderItems: ProviderAutomationDrawerOrderItem[];
  guardrailStatus: GuardrailFollowUpStatus | null;
  followUps: GuardrailFollowUpFeed;
};

type ProviderAutomationDrawerProps = {
  providers: ProviderAutomationDrawerEntry[];
  defaultOpen?: boolean;
  workflowTelemetry?: GuardrailWorkflowTelemetrySummary | null;
};

export function ProviderAutomationDrawer({
  providers,
  defaultOpen = false,
  workflowTelemetry = null,
}: ProviderAutomationDrawerProps) {
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.providerId, provider])),
    [providers],
  );
  const [selectedProviderId, setSelectedProviderId] = useState<string>(() => providers[0]?.providerId ?? "");
  const selectedProvider =
    providerById.get(selectedProviderId) ?? (providers.length > 0 ? providers[0] : null);

  const telemetryBanner = (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Workflow telemetry</p>
      <QuickOrderWorkflowTelemetry
        initialTelemetry={workflowTelemetry ?? null}
        refreshIntervalMs={60_000}
        testId="workflow-telemetry-provider-drawer"
      />
    </div>
  );

  if (providers.length === 0) {
    return (
      <div className="space-y-3">
        {telemetryBanner}
        <p className="text-xs text-white/60">This journey has not been linked to provider automation yet.</p>
      </div>
    );
  }

  const handleSelect = (providerId: string) => {
    if (!providerById.has(providerId) || providerId === selectedProviderId) {
      return;
    }
    setSelectedProviderId(providerId);
  };

  const orderItemSummary =
    selectedProvider?.orderItems.length
      ? selectedProvider.orderItems
          .map((item) => item.orderItemLabel?.trim() || item.orderItemId)
          .join(", ")
      : null;

  const guardrailStatus = selectedProvider?.guardrailStatus ?? null;
  const statusTimestamp = guardrailStatus?.updatedAt ?? null;
  const statusDate = formatTimestamp(statusTimestamp);

  return (
    <div className="space-y-3">
      {providers.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {providers.map((provider) => {
            const isActive = provider.providerId === selectedProvider?.providerId;
            return (
              <button
                key={provider.providerId}
                type="button"
                onClick={() => handleSelect(provider.providerId)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "border-emerald-300/70 bg-emerald-400/10 text-emerald-100"
                    : "border-white/20 bg-white/5 text-white/70 hover:border-white/40 hover:text-white"
                }`}
                aria-pressed={isActive}
              >
                {provider.providerName ?? provider.providerId}
              </button>
            );
          })}
        </div>
      ) : null}
      {selectedProvider ? (
        <>
          <p className="text-xs text-white/60">
            Linked provider{" "}
            <Link
              href={`/admin/fulfillment/providers/${selectedProvider.providerId}?tab=automation`}
              className="font-semibold text-emerald-300 underline-offset-4 hover:underline"
            >
              {selectedProvider.providerName ?? selectedProvider.providerId}
            </Link>
          </p>
          {orderItemSummary ? (
            <p className="text-xs text-white/50">Order items: {orderItemSummary}</p>
          ) : null}
          {guardrailStatus ? (
            <p className="text-xs text-white/50">
              Current status: {guardrailStatus.isPaused ? "Paused" : "Active"} · Last action{" "}
              {guardrailStatus.lastAction ?? "—"} on {statusDate}
            </p>
          ) : null}
          {selectedProvider.followUps.providerTelemetry ? (
            <ProviderTelemetrySummary telemetry={selectedProvider.followUps.providerTelemetry} />
          ) : null}
          {telemetryBanner}
          <GuardrailFollowUpTimeline
            providerId={selectedProvider.providerId}
            initialEntries={selectedProvider.followUps.entries}
            initialNextCursor={selectedProvider.followUps.nextCursor}
            defaultOpen={defaultOpen || selectedProvider.followUps.entries.length > 0}
            className="rounded-2xl border border-white/10 bg-black/30 p-4 text-sm text-white"
            emptyState={`No follow-ups logged yet for ${
              selectedProvider.providerName ?? selectedProvider.providerId
            }.`}
          />
        </>
      ) : (
        <p className="text-xs text-white/60">Select a provider to view automation history.</p>
      )}
    </div>
  );
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

type ProviderTelemetrySummaryProps = {
  telemetry: ProviderAutomationTelemetry;
};

function ProviderTelemetrySummary({ telemetry }: ProviderTelemetrySummaryProps) {
  const guardrail = telemetry.guardrails;
  const replays = telemetry.replays;
  const hotspots = selectGuardrailHotspots(telemetry.guardrailHitsByService);
  const overrideHotspots = selectOverrideHotspots(telemetry.ruleOverridesByService);

  return (
    <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-white">
      <p className="text-[0.65rem] uppercase tracking-[0.3em] text-white/40">Provider automation telemetry</p>
      <ul className="space-y-1 text-xs text-white/70">
        <li className="flex items-center justify-between gap-2">
          <span>Routed orders</span>
          <span className="font-semibold text-white">{telemetry.totalOrders}</span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>Replays executed</span>
          <span className="font-semibold text-white">
            {replays.executed}/{replays.total} · failed {replays.failed} · scheduled {replays.scheduled}
          </span>
        </li>
        <li className="flex items-center justify-between gap-2">
          <span>Guardrail checks</span>
          <span className="font-semibold text-white">
            {guardrail.evaluated}: pass {guardrail.pass} · warn {guardrail.warn} · fail {guardrail.fail}
          </span>
        </li>
        {hotspots.length ? (
          <li>
            Services under watch:{" "}
            {hotspots.map((entry, index) => (
              <span key={entry.serviceId}>
                {entry.label}
                {index < hotspots.length - 1 ? ", " : ""}
              </span>
            ))}
          </li>
        ) : null}
        {overrideHotspots.length ? (
          <li>
            Rule overrides:{" "}
            {overrideHotspots.map((entry, index) => (
              <span key={entry.serviceId}>
                {entry.label}
                {index < overrideHotspots.length - 1 ? ", " : ""}
              </span>
            ))}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function selectGuardrailHotspots(
  map: ProviderAutomationTelemetry["guardrailHitsByService"],
  limit = 3,
): Array<{ serviceId: string; label: string }> {
  if (!map) {
    return [];
  }
  return Object.entries(map)
    .filter(([, summary]) => summary.warn > 0 || summary.fail > 0)
    .sort((a, b) => b[1].fail - a[1].fail || b[1].warn - a[1].warn)
    .slice(0, limit)
    .map(([serviceId, summary]) => ({
      serviceId,
      label: `${serviceId} (warn ${summary.warn}, fail ${summary.fail})`,
    }));
}

function selectOverrideHotspots(
  map: ProviderAutomationTelemetry["ruleOverridesByService"],
  limit = 3,
): Array<{ serviceId: string; label: string }> {
  if (!map) {
    return [];
  }
  return Object.entries(map)
    .filter(([, summary]) => summary.totalOverrides > 0)
    .sort((a, b) => b[1].totalOverrides - a[1].totalOverrides)
    .slice(0, limit)
    .map(([serviceId, summary]) => ({
      serviceId,
      label: `${serviceId} (${summary.totalOverrides})`,
    }));
}
