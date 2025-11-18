import type {
  ExperimentExposureTelemetryEvent,
  GuardrailAlertTelemetryEvent,
  GuardrailAutomationTelemetryEvent,
  GuardrailTelemetryTags,
  GuardrailWorkflowTelemetryEvent,
  QuickOrderAbortTelemetryEvent,
  QuickOrderCompleteTelemetryEvent,
  QuickOrderStartTelemetryEvent,
  TelemetryEventBase,
  TelemetryEventEnvelope,
} from "@/types/reporting";
import type { QuickOrderTelemetryContext } from "@/types/quick-order";

const PUBLIC_TELEMETRY_ENDPOINT = process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT ?? null;
const SERVER_TELEMETRY_ENDPOINT = process.env.TELEMETRY_ENDPOINT ?? null;
const TELEMETRY_PROXY_PATH = "/api/telemetry";

type EventSource = TelemetryEventBase["source"];

type BaseEventOptions = {
  source?: EventSource;
  tags?: Partial<GuardrailTelemetryTags>;
  metadata?: Partial<TelemetryEventBase["metadata"]>;
};

const defaultTags: GuardrailTelemetryTags = {
  platformSlug: null,
  loyaltyTier: null,
  experimentSlug: null,
  experimentVariant: null,
  guardrailStatus: null,
};

const createEventId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `evt_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const buildTags = (tags?: Partial<GuardrailTelemetryTags>): GuardrailTelemetryTags => ({
  ...defaultTags,
  ...tags,
});

const createBaseEvent = (
  name: TelemetryEventEnvelope["name"],
  options: BaseEventOptions = {}
): TelemetryEventBase => ({
  id: createEventId(),
  name,
  source: options.source ?? "admin",
  recordedAt: new Date().toISOString(),
  guardrail: buildTags(options.tags),
  metadata: {
    ...options.metadata,
  },
});

const resolveTelemetryEndpoint = (): string | null => {
  if (PUBLIC_TELEMETRY_ENDPOINT) {
    return PUBLIC_TELEMETRY_ENDPOINT;
  }
  if (typeof window === "undefined") {
    return SERVER_TELEMETRY_ENDPOINT;
  }
  return TELEMETRY_PROXY_PATH;
};

export async function recordTelemetryEvent(event: TelemetryEventEnvelope): Promise<void> {
  const endpoint = resolveTelemetryEndpoint();
  const isQuickOrderEvent =
    event.name === "quick_order.start" || event.name === "quick_order.abort" || event.name === "quick_order.complete";
  const shouldCaptureLocally = isQuickOrderEvent && endpoint !== TELEMETRY_PROXY_PATH;
  if (shouldCaptureLocally) {
    void captureQuickOrderEvent(event);
  }
  if (!endpoint) {
    if (process.env.NODE_ENV !== "production") {
      console.debug("[telemetry:event]", event);
    }
    return;
  }

  if (typeof fetch === "undefined") {
    return;
  }

  try {
    await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Telemetry dispatch failed", error);
  }
}

async function captureQuickOrderEvent(
  event: QuickOrderStartTelemetryEvent | QuickOrderAbortTelemetryEvent | QuickOrderCompleteTelemetryEvent,
): Promise<void> {
  if (typeof window !== "undefined" && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([JSON.stringify(event)], { type: "application/json" });
    navigator.sendBeacon("/api/telemetry/quick-order", blob);
    return;
  }
  if (typeof fetch === "undefined") {
    return;
  }
  try {
    await fetch("/api/telemetry/quick-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,
    });
  } catch (error) {
    console.warn("Quick-order telemetry capture failed", error);
  }
}

type QuickOrderSnapshot = {
  productId: string | null;
  productTitle: string | null;
  platformLabel: string | null;
  platformHandle: string | null;
  platformType: string | null;
  followerBaseline: string | null;
  followerDelta: string | null;
  providerOrders: number | null;
  providerGuardrailFailures: number | null;
  providerGuardrailEvaluated: number | null;
  receiptStatus: string | null;
  receiptDetail: string | null;
};

type QuickOrderEventOptions = BaseEventOptions & {
  context?: QuickOrderTelemetryContext | null;
  sessionId?: string | null;
  productId?: string | null;
  productTitle?: string | null;
  platformLabel?: string | null;
  platformHandle?: string | null;
  platformType?: string | null;
  followerBaseline?: string | null;
  followerDelta?: string | null;
  providerOrders?: number | null;
  providerGuardrailFailures?: number | null;
  providerGuardrailEvaluated?: number | null;
  receiptStatus?: string | null;
  receiptDetail?: string | null;
};

const resolveQuickOrderSnapshot = (options: QuickOrderEventOptions): QuickOrderSnapshot => {
  const context = options.context ?? null;
  const providerTelemetry = context?.providerTelemetry ?? null;
  return {
    productId: options.productId ?? context?.productId ?? null,
    productTitle: options.productTitle ?? context?.productTitle ?? null,
    platformLabel: options.platformLabel ?? context?.platformLabel ?? null,
    platformHandle: options.platformHandle ?? context?.platformHandle ?? null,
    platformType: options.platformType ?? context?.platformType ?? null,
    followerBaseline: options.followerBaseline ?? context?.followerBaseline ?? null,
    followerDelta: options.followerDelta ?? context?.followerDelta ?? null,
    providerOrders:
      options.providerOrders ??
      (typeof providerTelemetry?.totalOrders === "number" ? providerTelemetry.totalOrders : null),
    providerGuardrailFailures:
      options.providerGuardrailFailures ??
      (typeof providerTelemetry?.guardrails?.fail === "number"
        ? providerTelemetry.guardrails.fail
        : null),
    providerGuardrailEvaluated:
      options.providerGuardrailEvaluated ??
      (typeof providerTelemetry?.guardrails?.evaluated === "number"
        ? providerTelemetry.guardrails.evaluated
        : null),
    receiptStatus: options.receiptStatus ?? null,
    receiptDetail: options.receiptDetail ?? null,
  };
};

const createQuickOrderEventBase = (
  name: "quick_order.start" | "quick_order.abort" | "quick_order.complete",
  snapshot: QuickOrderSnapshot,
  options: QuickOrderEventOptions
) => {
  const metadata = {
    productTitle: snapshot.productTitle,
    platformLabel: snapshot.platformLabel,
    platformHandle: snapshot.platformHandle,
    platformType: snapshot.platformType,
    followerBaseline: snapshot.followerBaseline,
    followerDelta: snapshot.followerDelta,
    providerOrders: snapshot.providerOrders,
    providerGuardrailFailures: snapshot.providerGuardrailFailures,
    providerGuardrailEvaluated: snapshot.providerGuardrailEvaluated,
    receiptStatus: snapshot.receiptStatus,
    receiptDetail: snapshot.receiptDetail,
    ...options.metadata,
  };
  const base = createBaseEvent(name, {
    ...options,
    source: options.source ?? "storefront",
    tags: {
      platformSlug: snapshot.platformType ?? options.tags?.platformSlug ?? null,
      loyaltyTier: options.tags?.loyaltyTier ?? null,
      experimentSlug: options.tags?.experimentSlug ?? null,
      experimentVariant: options.tags?.experimentVariant ?? null,
      guardrailStatus: options.tags?.guardrailStatus ?? null,
    },
    metadata,
  });
  return {
    ...base,
    sessionId: options.sessionId ?? null,
    productId: snapshot.productId,
    productTitle: snapshot.productTitle,
  };
};

type QuickOrderStartOptions = QuickOrderEventOptions;

export async function trackQuickOrderStart(options: QuickOrderStartOptions): Promise<void> {
  const snapshot = resolveQuickOrderSnapshot(options);
  const event: QuickOrderStartTelemetryEvent = {
    ...createQuickOrderEventBase("quick_order.start", snapshot, options),
  };
  await recordTelemetryEvent(event);
}

type QuickOrderAbortOptions = QuickOrderEventOptions & {
  reason?: string | null;
  stage?: string | null;
};

export async function trackQuickOrderAbort(options: QuickOrderAbortOptions): Promise<void> {
  const snapshot = resolveQuickOrderSnapshot(options);
  const event: QuickOrderAbortTelemetryEvent = {
    ...createQuickOrderEventBase("quick_order.abort", snapshot, {
      ...options,
      metadata: {
        quickOrderStage: options.stage ?? null,
        ...options.metadata,
      },
    }),
    reason: options.reason ?? null,
  };
  await recordTelemetryEvent(event);
}

type QuickOrderCompleteOptions = QuickOrderEventOptions & {
  outcome: "success" | "failure";
  blueprintApplied?: boolean | null;
  errorCode?: string | null;
};

export async function trackQuickOrderComplete(
  options: QuickOrderCompleteOptions
): Promise<void> {
  const snapshot = resolveQuickOrderSnapshot(options);
  const event: QuickOrderCompleteTelemetryEvent = {
    ...createQuickOrderEventBase("quick_order.complete", snapshot, {
      ...options,
      metadata: {
        quickOrderOutcome: options.outcome ?? null,
        blueprintApplied: options.blueprintApplied ?? null,
        quickOrderErrorCode: options.errorCode ?? null,
        ...options.metadata,
      },
    }),
    outcome: options.outcome ?? null,
  };
  await recordTelemetryEvent(event);
}

type GuardrailAlertOptions = BaseEventOptions & {
  slug: string;
  variantKey: string;
  severity: GuardrailAlertTelemetryEvent["severity"];
};

export async function trackGuardrailAlert(options: GuardrailAlertOptions): Promise<void> {
  const event: GuardrailAlertTelemetryEvent = {
    ...createBaseEvent("guardrail.alert", {
      ...options,
      tags: {
        experimentSlug: options.slug,
        experimentVariant: options.variantKey,
        guardrailStatus: options.severity === "critical" ? "breached" : "warning",
        ...options.tags,
      },
    }),
    severity: options.severity,
    targetSlug: options.slug,
    targetVariantKey: options.variantKey,
  };
  await recordTelemetryEvent(event);
}

type GuardrailAutomationOptions = BaseEventOptions & {
  slug: string;
  variantKey: string;
  action: GuardrailAutomationTelemetryEvent["action"];
  providerId?: string | null;
};

export async function trackGuardrailAutomation(options: GuardrailAutomationOptions): Promise<void> {
  const event: GuardrailAutomationTelemetryEvent = {
    ...createBaseEvent("guardrail.automation", {
      ...options,
      tags: {
        experimentSlug: options.slug,
        experimentVariant: options.variantKey,
        guardrailStatus: options.tags?.guardrailStatus ?? null,
      },
      metadata: {
        ...options.metadata,
        providerId: options.providerId ?? options.metadata?.providerId ?? null,
      },
    }),
    action: options.action,
    targetSlug: options.slug,
    targetVariantKey: options.variantKey,
  };
  await recordTelemetryEvent(event);
}

type GuardrailWorkflowOptions = BaseEventOptions & {
  workflowAction: string;
  providerId?: string | null;
  providerName?: string | null;
};

export async function trackGuardrailWorkflow(
  options: GuardrailWorkflowOptions
): Promise<void> {
  const event: GuardrailWorkflowTelemetryEvent = {
    ...createBaseEvent("guardrail.workflow", {
      ...options,
      source: options.source ?? "admin",
    }),
    workflowAction: options.workflowAction,
    providerId: options.providerId ?? null,
    providerName: options.providerName ?? null,
  };
  await recordTelemetryEvent(event);
}

type ExperimentExposureOptions = BaseEventOptions & {
  slug: string;
  variantKey: string;
  isControl: boolean | null;
};

export async function trackExperimentExposure(options: ExperimentExposureOptions): Promise<void> {
  const event: ExperimentExposureTelemetryEvent = {
    ...createBaseEvent("experiment.exposure", {
      ...options,
      tags: {
        experimentSlug: options.slug,
        experimentVariant: options.variantKey,
        guardrailStatus: options.tags?.guardrailStatus ?? null,
      },
    }),
    targetSlug: options.slug,
    targetVariantKey: options.variantKey,
    isControl: options.isControl ?? null,
  };
  await recordTelemetryEvent(event);
}
