import "server-only";

import { trackGuardrailAlert } from "@/lib/telemetry/events";
import type {
  AutomationWorkflowStatus,
  ExperimentAnalyticsOverview,
  GuardrailAlert,
} from "@/types/reporting";
import type { ProviderAutomationStatus } from "@/types/provider-automation";
import {
  fetchProviderAutomationSnapshot,
  fetchProviderAutomationStatus,
  type ProviderAutomationSnapshot,
} from "@/server/fulfillment/provider-automation-insights";
import { fetchProviderPlatformContexts } from "@/server/fulfillment/provider-platform-contexts";
import { fetchOnboardingExperimentEvents } from "./onboarding-experiment-events";
import { buildExperimentAnalyticsOverview } from "./experiment-analytics";
import { fetchQuickOrderFunnelMetrics } from "./quick-order-funnel";

type AlertsDigestEntry = {
  providerId?: string;
  providerName?: string;
  reasons?: unknown;
  guardrailFailures?: unknown;
  guardrailWarnings?: unknown;
  replayFailures?: unknown;
  replayTotal?: unknown;
};

const AUTOMATION_DESCRIPTION =
  "Provider automation alerts monitor guardrail posture, replay failures, and blueprint load anomalies.";
const AUTOMATION_WORKFLOW = "provider-automation-alerts";
const PLATFORM_CONTEXT_MAX = 3;

export async function fetchGuardrailAlerts(): Promise<GuardrailAlert[]> {
  const [status, snapshot] = await Promise.all([
    fetchProviderAutomationStatus().catch(() => null),
    fetchProviderAutomationSnapshot(20).catch(() => null),
  ]);

  let alertsFromStatus = buildAlertsFromStatus(status);
  if (alertsFromStatus.length > 0) {
    alertsFromStatus = await enrichAlertsWithPlatformContext(alertsFromStatus);
    await emitTelemetry(alertsFromStatus);
    return alertsFromStatus;
  }

  let fallbackAlerts = buildAlertsFromSnapshot(snapshot);
  if (fallbackAlerts.length > 0) {
    fallbackAlerts = await enrichAlertsWithPlatformContext(fallbackAlerts);
    await emitTelemetry(fallbackAlerts);
  }
  return fallbackAlerts;
}

export async function fetchAutomationWorkflowStatus(): Promise<AutomationWorkflowStatus> {
  try {
    const status = await fetchProviderAutomationStatus();
    const summary = extractAlertsSummary(status);
    return {
      workflow: AUTOMATION_WORKFLOW,
      description: AUTOMATION_DESCRIPTION,
      lastRunAt: status.alerts?.ranAt ?? null,
      durationSeconds: typeof summary?.durationSeconds === "number" ? summary.durationSeconds : null,
      lastRunStatus: determineAutomationStatus(summary),
      nextRunEta: null,
      latestCursor: null,
      runbookUrl: "/docs/runbooks/pricing-experiments-operator",
      actionUrl: "https://github.com/smplat/actions/actions/workflows/onboarding-experiment-export.yml",
      summary,
    };
  } catch {
    return {
      workflow: AUTOMATION_WORKFLOW,
      description: AUTOMATION_DESCRIPTION,
      lastRunAt: null,
      durationSeconds: null,
      lastRunStatus: "failed",
      nextRunEta: null,
      latestCursor: null,
      runbookUrl: "/docs/runbooks/pricing-experiments-operator",
      actionUrl: "https://github.com/smplat/actions/actions/workflows/onboarding-experiment-export.yml",
      summary: null,
    };
  }
}

export async function fetchExperimentAnalyticsOverview(): Promise<ExperimentAnalyticsOverview> {
  const [{ events }, quickOrderFunnel] = await Promise.all([
    fetchOnboardingExperimentEvents({ limit: 500 }),
    fetchQuickOrderFunnelMetrics().catch(() => null),
  ]);
  const overview = buildExperimentAnalyticsOverview(events);
  return {
    ...overview,
    quickOrderFunnel: quickOrderFunnel ?? null,
  };
}

function buildAlertsFromStatus(status: ProviderAutomationStatus | null): GuardrailAlert[] {
  if (!status?.alerts?.summary) {
    return [];
  }
  const digest = status.alerts.summary.alertsDigest;
  if (!Array.isArray(digest) || digest.length === 0) {
    return [];
  }
  const triggeredAt = status.alerts.ranAt ?? new Date().toISOString();

  return digest
    .map((entry, index) => {
      const normalized = entry as AlertsDigestEntry;
      const providerId = typeof normalized.providerId === "string" ? normalized.providerId : `provider-${index}`;
      const providerName =
        typeof normalized.providerName === "string" && normalized.providerName.trim().length > 0
          ? normalized.providerName.trim()
          : providerId;
      const guardrailFailures = coerceNumber(normalized.guardrailFailures);
      const guardrailWarnings = coerceNumber(normalized.guardrailWarnings);
      const replayFailures = coerceNumber(normalized.replayFailures);
      const replayTotal = coerceNumber(normalized.replayTotal);
      const severity = determineSeverity(guardrailFailures, guardrailWarnings, replayFailures);
      if (!severity) {
        return null;
      }
      const reasons = Array.isArray(normalized.reasons)
        ? normalized.reasons.map((reason) => String(reason))
        : buildReasons(guardrailFailures, guardrailWarnings, replayFailures, replayTotal);

      return {
        id: `${providerId}-${index}`,
        providerId,
        providerName,
        severity,
        detectedAt: triggeredAt,
        reasons,
        guardrailFailures,
        guardrailWarnings,
        replayFailures,
        replayTotal,
        linkHref: `/admin/fulfillment/providers/${providerId}`,
        automationHref: `/admin/fulfillment/providers/${providerId}?tab=automation`,
        platformContexts: [],
      } satisfies GuardrailAlert;
    })
    .filter((alert): alert is GuardrailAlert => alert !== null);
}

function buildAlertsFromSnapshot(snapshot: ProviderAutomationSnapshot | null): GuardrailAlert[] {
  if (!snapshot) {
    return [];
  }
  const detectedAt = new Date().toISOString();
  const alerts: GuardrailAlert[] = [];

  for (const provider of snapshot.providers ?? []) {
    const guardrails = provider.telemetry.guardrails;
    const replays = provider.telemetry.replays;
    const severity = determineSeverity(guardrails.fail, guardrails.warn, replays.failed);
    if (!severity) {
      continue;
    }
    alerts.push({
      id: provider.id,
      providerId: provider.id,
      providerName: provider.name,
      severity,
      detectedAt,
      reasons: buildReasons(guardrails.fail, guardrails.warn, replays.failed, replays.total),
      guardrailFailures: guardrails.fail,
      guardrailWarnings: guardrails.warn,
      replayFailures: replays.failed,
      replayTotal: replays.total,
      linkHref: `/admin/fulfillment/providers/${provider.id}`,
      automationHref: `/admin/fulfillment/providers/${provider.id}?tab=automation`,
      platformContexts: [],
    });
  }

  return alerts;
}

async function emitTelemetry(alerts: GuardrailAlert[]): Promise<void> {
  await Promise.all(
    alerts.map((alert) =>
      trackGuardrailAlert({
        slug: alert.providerId,
        variantKey: alert.providerName,
        severity: alert.severity,
        tags: {
          experimentSlug: alert.providerId,
          experimentVariant: alert.providerName,
          guardrailStatus: alert.severity === "critical" ? "breached" : "warning",
          platformSlug: alert.platformContexts?.[0]?.id ?? null,
        },
        metadata: {
          guardrailFailures: alert.guardrailFailures,
          guardrailWarnings: alert.guardrailWarnings,
          replayFailures: alert.replayFailures,
        },
      }).catch(() => undefined)
    )
  );
}

function extractAlertsSummary(status: ProviderAutomationStatus | null): Record<string, unknown> | null {
  const summary = status?.alerts?.summary;
  return summary && typeof summary === "object" ? (summary as Record<string, unknown>) : null;
}

function determineAutomationStatus(summary: Record<string, unknown> | null): "success" | "warning" | "failed" {
  if (!summary) {
    return "success";
  }
  const alerts = coerceNumber(summary.alerts);
  const alertsSent = coerceNumber(summary.alertsSent);
  const loadAlerts = coerceNumber(summary.loadAlerts);
  if (alerts > 0 || alertsSent > 0 || loadAlerts > 0) {
    return "warning";
  }
  return "success";
}

function determineSeverity(
  guardrailFailures: number,
  guardrailWarnings: number,
  replayFailures: number
): GuardrailAlert["severity"] | null {
  if (guardrailFailures > 0) {
    return "critical";
  }
  if (guardrailWarnings > 0 || replayFailures > 0) {
    return "warning";
  }
  return null;
}

function buildReasons(
  guardrailFailures: number,
  guardrailWarnings: number,
  replayFailures: number,
  replayTotal: number
): string[] {
  const reasons: string[] = [];
  if (guardrailFailures > 0) {
    reasons.push(`${guardrailFailures} guardrail failure${guardrailFailures === 1 ? "" : "s"}`);
  }
  if (guardrailWarnings > 0) {
    reasons.push(`${guardrailWarnings} guardrail warning${guardrailWarnings === 1 ? "" : "s"}`);
  }
  if (replayFailures > 0) {
    const replayLabel =
      replayTotal > 0 ? `${replayFailures}/${replayTotal} replay failures` : `${replayFailures} replay failures`;
    reasons.push(replayLabel);
  }
  return reasons.length > 0 ? reasons : ["Investigate automation telemetry for anomalies"];
}

function coerceNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function enrichAlertsWithPlatformContext(alerts: GuardrailAlert[]): Promise<GuardrailAlert[]> {
  if (!alerts.length) {
    return [];
  }
  const providerIds = Array.from(new Set(alerts.map((alert) => alert.providerId)));
  const contextsByProvider = await fetchProviderPlatformContexts(providerIds, PLATFORM_CONTEXT_MAX);
  return alerts.map((alert) => ({
    ...alert,
    platformContexts: contextsByProvider[alert.providerId] ?? [],
  }));
}
