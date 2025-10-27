import { useEffect, useMemo, useRef, useState } from "react";

import type { RemediationCategory } from "@/shared/marketing/remediation";

import type {
  MarketingPreviewSnapshot,
  MarketingPreviewTimelineEntry,
  MarketingPreviewTimelineRouteSummary
} from "@/server/cms/preview";

// meta: hook: useLivePreview

export type LiveBlockFallback = {
  used: boolean;
  reason?: string;
  source?: string;
};

export type LiveBlockTrace = {
  blockType?: string;
  sectionLabel?: string;
  lexicalIndex: number;
  lexicalKey?: string;
  provenance: "payload" | "fixture";
  operations: string[];
  warnings: string[];
  normalized: boolean;
  skipReason?: string;
};

export type LiveRecoveryHintCategory = RemediationCategory;

export type LiveRecoveryHint = {
  message: string;
  category: LiveRecoveryHintCategory;
  fieldPath?: string;
};

export type LivePreviewVariantDescriptor = {
  key: string;
  label: string;
  persona?: string | null;
  campaign?: string | null;
  featureFlag?: string | null;
};

export type LiveBlockDiffStatus = "added" | "removed" | "regressed" | "improved" | "steady";

export type LiveBlockDiff = {
  blockKey: string;
  fingerprint?: string;
  traceHash: string;
  status: LiveBlockDiffStatus;
  blockKind?: string;
  previousSeverity?: number;
  severity: number;
};

export type LiveBlockDiffCluster = {
  blockKey: string;
  fingerprint?: string;
  traceHash: string;
  blockKind?: string;
  statusHistory: LiveBlockDiffStatus[];
  severityHistory: number[];
  totals: Record<LiveBlockDiffStatus, number>;
  regressionRun: number;
  lastSeenAt: string;
};

export type LiveFingerprintRecord = {
  blockKey: string;
  fingerprint?: string;
  traceHash: string;
  blockKind?: string;
  lastSeenAt: string;
  status: LiveBlockDiffStatus;
};

export type LiveValidationBlock = {
  key?: string;
  kind?: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  fingerprint?: string;
  recoveryHints: LiveRecoveryHint[];
  fallback?: LiveBlockFallback;
  trace: LiveBlockTrace;
};

export type LiveDiagnosticsSection = {
  label: string;
  index: number;
  warnings: string[];
  blockCount: number;
  invalidBlocks: number;
};

export type LiveDiagnosticsPayload = {
  summary: {
    totalBlocks: number;
    invalidBlocks: number;
    warningBlocks: number;
  };
  sections: LiveDiagnosticsSection[];
  blocks: LiveValidationBlock[];
  normalizationWarnings: string[];
};

export type LiveValidationEntry = {
  id: string;
  route: string;
  receivedAt: string;
  valid: boolean;
  warnings: string[];
  blocks: LiveValidationBlock[];
  diagnostics: LiveDiagnosticsPayload;
  collection?: string;
  docId?: string | null;
  label?: string | null;
  environment?: string | null;
  slug?: string | null;
};

export type LiveDiagnosticsLedgerEntry = {
  id: string;
  route: string;
  receivedAt: string;
  variant: LivePreviewVariantDescriptor;
  summary: LiveDiagnosticsPayload["summary"];
  normalizationWarnings: string[];
  sections: LiveDiagnosticsSection[];
  blocks: LiveValidationBlock[];
  delta: {
    invalidBlocks: number;
    warningBlocks: number;
  };
  blockDiffs: LiveBlockDiff[];
  fingerprintLedger: Record<string, LiveFingerprintRecord>;
  diffSummary: Record<LiveBlockDiffStatus, number>;
};

export type LivePreviewConnectionState = "connecting" | "connected" | "disconnected";

type LivePreviewEvent = {
  type: "marketing-preview-delta";
  route: string;
  slug?: string | null;
  label?: string | null;
  environment?: string | null;
  generatedAt: string;
  markup: string;
  blockKinds: string[];
  sectionCount: number;
  variant: LivePreviewVariantDescriptor;
  hero?: MarketingPreviewSnapshot["hero"];
  metrics?: MarketingPreviewSnapshot["metrics"];
  collection: string;
  docId?: string | null;
  validation: {
    ok: boolean;
    warnings: string[];
    blocks: LiveValidationBlock[];
  };
  diagnostics: LiveDiagnosticsPayload;
};

type UseLivePreviewArgs = {
  current: MarketingPreviewTimelineEntry;
  history: MarketingPreviewTimelineEntry[];
};

export type RouteDiagnosticsVariantState = {
  descriptor: LivePreviewVariantDescriptor;
  latest?: LiveDiagnosticsLedgerEntry;
  history: LiveDiagnosticsLedgerEntry[];
  fingerprints: Record<string, LiveFingerprintRecord>;
  diffSummary: Record<LiveBlockDiffStatus, number>;
  diffClusters: Record<string, LiveBlockDiffCluster>;
  sinceLastGreen?: {
    captureId?: string;
    at?: string;
    steps: number;
  };
};

export type LiveRegressionHotspot = LiveBlockDiff & {
  variantKey: string;
  regressionCount: number;
  lastSeenAt: string;
};

export type RouteDiagnosticsAggregatedState = {
  baselineKey: string;
  variantKeys: string[];
  regressionHotspots: LiveRegressionHotspot[];
  driftByVariant: Record<string, { invalidDelta: number; warningDelta: number }>;
};

export type RouteDiagnosticsState = Record<
  string,
  {
    variants: Record<string, RouteDiagnosticsVariantState>;
    aggregated: RouteDiagnosticsAggregatedState;
  }
>;

type UseLivePreviewResult = {
  timelineEntries: MarketingPreviewTimelineEntry[];
  connectionState: LivePreviewConnectionState;
  validationQueue: LiveValidationEntry[];
  clearValidationQueue: () => void;
  routeValidation: Record<string, LiveValidationEntry>;
  routeDiagnostics: RouteDiagnosticsState;
  variants: LivePreviewVariantDescriptor[];
  baselineVariantKey: string;
};

const createValidationEntry = (route: string, event: LivePreviewEvent): LiveValidationEntry => {
  const blocks = event.validation.blocks.map((block, index) => ({
    ...block,
    key: block.key ?? `${route}-${block.kind ?? "block"}-${index}`
  }));

  return {
    id: `${route}-${event.generatedAt}`,
    route,
    receivedAt: event.generatedAt,
    valid: event.validation.ok,
    warnings: event.validation.warnings,
    blocks,
    diagnostics: {
      ...event.diagnostics,
      blocks
    },
    collection: event.collection,
    docId: event.docId,
    label: event.label,
    environment: event.environment,
    slug: event.slug
  };
};

const createDiagnosticsLedgerEntry = (
  route: string,
  entry: LiveValidationEntry,
  previous?: LiveDiagnosticsLedgerEntry,
  descriptor?: LivePreviewVariantDescriptor,
  previousFingerprints?: Record<string, LiveFingerprintRecord>
): LiveDiagnosticsLedgerEntry => {
  const descriptorSnapshot =
    descriptor ?? previous?.variant ?? ({ key: "variant-baseline", label: "Baseline" } as LivePreviewVariantDescriptor);
  const previousSummary = previous?.summary;
  const delta = {
    invalidBlocks: entry.diagnostics.summary.invalidBlocks - (previousSummary?.invalidBlocks ?? 0),
    warningBlocks: entry.diagnostics.summary.warningBlocks - (previousSummary?.warningBlocks ?? 0)
  };

  const buildTraceHash = (trace: LiveBlockTrace) => {
    const seed = [
      trace.lexicalKey ?? "",
      trace.lexicalIndex,
      trace.blockType ?? "",
      trace.sectionLabel ?? "",
      trace.provenance,
      trace.operations.join("|")
    ].join(":");
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = (hash * 16777619) >>> 0;
    }
    return `trace-${hash.toString(16)}`;
  };

  const severityOf = (block: LiveValidationBlock) => {
    if (!block.valid || block.errors.length > 0) {
      return 2;
    }
    if (block.warnings.length > 0) {
      return 1;
    }
    return 0;
  };

  const toBlockIdentifier = (block: LiveValidationBlock) => {
    const traceHash = buildTraceHash(block.trace);
    return {
      blockKey:
        block.fingerprint ?? `${traceHash}:${block.trace.lexicalKey ?? block.trace.lexicalIndex}:${block.kind ?? "block"}`,
      traceHash
    };
  };

  const previousBlocks = new Map<string, { block: LiveValidationBlock; severity: number; traceHash: string }>();
  previous?.blocks.forEach((block) => {
    const { blockKey, traceHash } = toBlockIdentifier(block);
    previousBlocks.set(blockKey, {
      block,
      severity: severityOf(block),
      traceHash
    });
  });

  const diffSummary: Record<LiveBlockDiffStatus, number> = {
    added: 0,
    removed: 0,
    regressed: 0,
    improved: 0,
    steady: 0
  };

  const blockDiffs: LiveBlockDiff[] = [];
  let fingerprintLedger: Record<string, LiveFingerprintRecord> = {};

  entry.blocks.forEach((block) => {
    const severity = severityOf(block);
    const { blockKey, traceHash } = toBlockIdentifier(block);
    const previousBlock = previousBlocks.get(blockKey);
    let status: LiveBlockDiffStatus = "steady";
    let previousSeverity: number | undefined;

    if (!previousBlock) {
      status = "added";
    } else {
      previousSeverity = previousBlock.severity;
      if (severity > previousBlock.severity) {
        status = "regressed";
      } else if (severity < previousBlock.severity) {
        status = "improved";
      }
      previousBlocks.delete(blockKey);
    }

    diffSummary[status] += 1;

    blockDiffs.push({
      blockKey,
      fingerprint: block.fingerprint,
      traceHash,
      status,
      blockKind: block.kind,
      previousSeverity,
      severity
    });

    fingerprintLedger[blockKey] = {
      blockKey,
      fingerprint: block.fingerprint,
      traceHash,
      blockKind: block.kind,
      lastSeenAt: entry.receivedAt,
      status
    };
  });

  previousBlocks.forEach((value, key) => {
    diffSummary.removed += 1;
    blockDiffs.push({
      blockKey: key,
      fingerprint: value.block.fingerprint,
      traceHash: value.traceHash,
      status: "removed",
      blockKind: value.block.kind,
      previousSeverity: value.severity,
      severity: -1
    });
    fingerprintLedger[key] = {
      blockKey: key,
      fingerprint: value.block.fingerprint,
      traceHash: value.traceHash,
      blockKind: value.block.kind,
      lastSeenAt: entry.receivedAt,
      status: "removed"
    };
  });

  if (previousFingerprints) {
    const merged = { ...previousFingerprints };
    Object.entries(fingerprintLedger).forEach(([key, record]) => {
      merged[key] = record;
    });
    const limit = 48;
    const ordered = Object.values(merged).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    const trimmed = ordered.slice(0, limit);
    fingerprintLedger = trimmed.reduce<Record<string, LiveFingerprintRecord>>((accumulator, record) => {
      accumulator[record.blockKey] = record;
      return accumulator;
    }, {});
  }

  return {
    id: entry.id,
    route,
    receivedAt: entry.receivedAt,
    variant: descriptorSnapshot,
    summary: entry.diagnostics.summary,
    normalizationWarnings: entry.diagnostics.normalizationWarnings,
    sections: entry.diagnostics.sections,
    blocks: entry.blocks,
    delta,
    blockDiffs,
    fingerprintLedger,
    diffSummary
  };
};

const updateRouteSummaries = (
  summaries: MarketingPreviewTimelineRouteSummary[],
  route: string,
  blockKinds: string[],
  sectionCount: number,
  diffDetected: boolean
): MarketingPreviewTimelineRouteSummary[] => {
  let hasRoute = false;

  const next = summaries.map((summary) => {
    if (summary.route !== route) {
      return summary;
    }
    hasRoute = true;
    return {
      ...summary,
      hasDraft: true,
      blockKinds,
      sectionCount,
      diffDetected
    };
  });

  if (!hasRoute) {
    next.push({
      route,
      hasDraft: true,
      hasPublished: false,
      diffDetected,
      sectionCount,
      blockKinds
    });
  }

  return next.sort((a, b) => a.route.localeCompare(b.route));
};

const mergeSnapshot = (
  snapshot: MarketingPreviewSnapshot | undefined,
  event: LivePreviewEvent,
  fallbackHero?: MarketingPreviewSnapshot["hero"],
  fallbackMetrics?: MarketingPreviewSnapshot["metrics"],
  fallbackTitle?: string
): MarketingPreviewSnapshot => ({
  route: event.route,
  preview: true,
  hero: event.hero ?? snapshot?.hero ?? fallbackHero,
  title: snapshot?.title ?? fallbackTitle,
  sectionCount: event.sectionCount,
  blockKinds: event.blockKinds,
  metrics: event.metrics ?? snapshot?.metrics ?? fallbackMetrics,
  markup: event.markup
});

const computeSinceLastGreen = (
  history: LiveDiagnosticsLedgerEntry[]
): RouteDiagnosticsVariantState["sinceLastGreen"] => {
  if (!history.length) {
    return undefined;
  }

  let steps = 0;
  for (const entry of history) {
    if (entry.summary.invalidBlocks === 0 && entry.summary.warningBlocks === 0) {
      return {
        captureId: entry.id,
        at: entry.receivedAt,
        steps
      };
    }
    steps += 1;
  }

  return { steps };
};

const updateDiffClusters = (
  previous: Record<string, LiveBlockDiffCluster> | undefined,
  diffs: LiveBlockDiff[],
  receivedAt: string
): Record<string, LiveBlockDiffCluster> => {
  const historyLimit = 16;
  const limit = 48;
  const clusters = previous ? { ...previous } : {};

  diffs.forEach((diff) => {
    const existing = clusters[diff.blockKey];
    const totals = existing?.totals
      ? { ...existing.totals }
      : { added: 0, removed: 0, regressed: 0, improved: 0, steady: 0 };
    totals[diff.status] = (totals[diff.status] ?? 0) + 1;

    const statusHistory = [diff.status, ...(existing?.statusHistory ?? [])].slice(0, historyLimit);
    const severityHistory = [diff.severity, ...(existing?.severityHistory ?? [])].slice(0, historyLimit);

    const regressionRun = diff.status === "regressed"
      ? (existing?.statusHistory?.[0] === "regressed" ? (existing?.regressionRun ?? 0) + 1 : 1)
      : diff.status === "improved"
        ? 0
        : existing?.regressionRun ?? 0;

    clusters[diff.blockKey] = {
      blockKey: diff.blockKey,
      fingerprint: diff.fingerprint ?? existing?.fingerprint,
      traceHash: diff.traceHash,
      blockKind: diff.blockKind ?? existing?.blockKind,
      statusHistory,
      severityHistory,
      totals,
      regressionRun,
      lastSeenAt: receivedAt
    };
  });

  const trimmed = Object.values(clusters)
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, limit)
    .reduce<Record<string, LiveBlockDiffCluster>>((accumulator, cluster) => {
      accumulator[cluster.blockKey] = cluster;
      return accumulator;
    }, {});

  return trimmed;
};

const resolveBaselineKey = (
  variants: Record<string, RouteDiagnosticsVariantState>
): string => {
  const entries = Object.values(variants);
  if (!entries.length) {
    return "variant-baseline";
  }

  const baseline = entries.find((variant) => {
    const { persona, campaign, featureFlag } = variant.descriptor;
    return !persona && !campaign && !featureFlag;
  });

  return baseline?.descriptor.key ?? entries[0].descriptor.key;
};

const collectRegressionHotspots = (
  variants: Record<string, RouteDiagnosticsVariantState>
): LiveRegressionHotspot[] => {
  const hotspots: LiveRegressionHotspot[] = [];

  Object.entries(variants).forEach(([variantKey, variant]) => {
    Object.values(variant.diffClusters ?? {}).forEach((cluster) => {
      const regressionCount = cluster.totals.regressed ?? 0;
      if (regressionCount <= 0) {
        return;
      }
      const severity = cluster.severityHistory[0] ?? 0;
      const previousSeverity = cluster.severityHistory[1];
      const status = cluster.statusHistory[0] ?? "steady";

      hotspots.push({
        blockKey: cluster.blockKey,
        fingerprint: cluster.fingerprint,
        traceHash: cluster.traceHash,
        blockKind: cluster.blockKind,
        status,
        previousSeverity,
        severity,
        variantKey,
        regressionCount,
        lastSeenAt: cluster.lastSeenAt
      });
    });
  });

  return hotspots
    .sort((a, b) => {
      if (b.regressionCount !== a.regressionCount) {
        return b.regressionCount - a.regressionCount;
      }
      const aDelta = a.severity - (a.previousSeverity ?? 0);
      const bDelta = b.severity - (b.previousSeverity ?? 0);
      if (bDelta !== aDelta) {
        return bDelta - aDelta;
      }
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    })
    .slice(0, 12);
};

const computeAggregatedDiagnostics = (
  variants: Record<string, RouteDiagnosticsVariantState>
): RouteDiagnosticsAggregatedState => {
  const variantKeys = Object.keys(variants);
  if (variantKeys.length === 0) {
    return {
      baselineKey: "variant-baseline",
      variantKeys: [],
      regressionHotspots: [],
      driftByVariant: {}
    };
  }

  const baselineKey = resolveBaselineKey(variants);
  const sortedKeys = variantKeys.sort((a, b) => a.localeCompare(b));
  const regressionHotspots = collectRegressionHotspots(variants);

  const baselineEntry = variants[baselineKey]?.latest;
  const baselineInvalid = baselineEntry?.summary.invalidBlocks ?? 0;
  const baselineWarning = baselineEntry?.summary.warningBlocks ?? 0;

  const driftByVariant = sortedKeys.reduce<Record<string, { invalidDelta: number; warningDelta: number }>>(
    (accumulator, key) => {
      const latest = variants[key]?.latest;
      const invalid = latest?.summary.invalidBlocks ?? 0;
      const warning = latest?.summary.warningBlocks ?? 0;
      accumulator[key] = {
        invalidDelta: invalid - baselineInvalid,
        warningDelta: warning - baselineWarning
      };
      return accumulator;
    },
    {}
  );

  return {
    baselineKey,
    variantKeys: sortedKeys,
    regressionHotspots,
    driftByVariant
  };
};

export const useLivePreview = ({ current, history }: UseLivePreviewArgs): UseLivePreviewResult => {
  const [liveEntry, setLiveEntry] = useState<MarketingPreviewTimelineEntry>(current);
  const [connectionState, setConnectionState] = useState<LivePreviewConnectionState>("connecting");
  const [validationQueue, setValidationQueue] = useState<LiveValidationEntry[]>([]);
  const [routeValidation, setRouteValidation] = useState<Record<string, LiveValidationEntry>>({});
  const [routeDiagnostics, setRouteDiagnostics] = useState<RouteDiagnosticsState>({});
  const [variantCatalog, setVariantCatalog] = useState<Record<string, LivePreviewVariantDescriptor>>({});
  const isMounted = useRef(true);

  useEffect(() => {
    setLiveEntry(current);
  }, [current]);

  useEffect(() => {
    setRouteValidation({});
    setValidationQueue([]);
    setRouteDiagnostics({});
    setVariantCatalog({});
  }, [current.generatedAt]);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const source = new EventSource("/api/marketing-preview/stream");
    setConnectionState("connecting");

    const handleReady = () => {
      if (!isMounted.current) return;
      setConnectionState("connected");
    };

    const handleError = () => {
      if (!isMounted.current) return;
      setConnectionState("disconnected");
      source.close();
    };

    const handleEvent = (event: MessageEvent<string>) => {
      if (!isMounted.current) {
        return;
      }

      let payload: LivePreviewEvent | null = null;
      try {
        payload = JSON.parse(event.data) as LivePreviewEvent;
      } catch {
        return;
      }

      if (!payload || payload.type !== "marketing-preview-delta") {
        return;
      }

      const message = payload;
      setConnectionState("connected");

      setLiveEntry((entry) => {
        if (!entry) {
          return entry;
        }

        const publishedSnapshots = entry.snapshots.published;
        const draftSnapshots = [...entry.snapshots.draft];
        const draftIndex = draftSnapshots.findIndex((snapshot) => snapshot.route === message.route);
        const publishedMatch = publishedSnapshots.find((snapshot) => snapshot.route === message.route);
        const existingDraft = draftIndex >= 0 ? draftSnapshots[draftIndex] : undefined;

        const nextSnapshot = mergeSnapshot(
          existingDraft,
          message,
          publishedMatch?.hero,
          publishedMatch?.metrics,
          publishedMatch?.title
        );

        if (draftIndex >= 0) {
          draftSnapshots[draftIndex] = { ...existingDraft, ...nextSnapshot };
        } else {
          draftSnapshots.push(nextSnapshot);
        }

        const diffDetected = (publishedMatch?.markup ?? "") !== message.markup;
        const updatedRoutes = updateRouteSummaries(
          entry.routes,
          message.route,
          message.blockKinds,
          message.sectionCount,
          diffDetected
        ).map((summary) => {
          if (summary.route === message.route) {
            return { ...summary, hasPublished: summary.hasPublished || Boolean(publishedMatch) };
          }
          return summary;
        });

        return {
          ...entry,
          snapshots: {
            ...entry.snapshots,
            draft: draftSnapshots.sort((a, b) => a.route.localeCompare(b.route))
          },
          routes: updatedRoutes
        };
      });

      const validationEntry = createValidationEntry(message.route, message);

      setRouteValidation((state) => ({
        ...state,
        [message.route]: validationEntry
      }));

      setVariantCatalog((catalog) => {
        if (catalog[message.variant.key]) {
          return catalog;
        }
        return { ...catalog, [message.variant.key]: message.variant };
      });

      setRouteDiagnostics((state) => {
        const previousRoute = state[message.route];
        const previousVariants = previousRoute?.variants ?? {};
        const previousVariant = previousVariants[message.variant.key];
        const ledgerEntry = createDiagnosticsLedgerEntry(
          message.route,
          validationEntry,
          previousVariant?.latest,
          message.variant,
          previousVariant?.fingerprints
        );
        const historyEntries = previousVariant
          ? [ledgerEntry, ...previousVariant.history]
          : [ledgerEntry];
        const trimmedHistory = historyEntries.slice(0, 12);
        const nextClusters = updateDiffClusters(
          previousVariant?.diffClusters,
          ledgerEntry.blockDiffs,
          ledgerEntry.receivedAt
        );

        const nextVariantState: RouteDiagnosticsVariantState = {
          descriptor: message.variant,
          latest: ledgerEntry,
          history: trimmedHistory,
          fingerprints: ledgerEntry.fingerprintLedger,
          diffSummary: ledgerEntry.diffSummary,
          diffClusters: nextClusters,
          sinceLastGreen: computeSinceLastGreen(trimmedHistory)
        };

        const nextVariants = {
          ...previousVariants,
          [message.variant.key]: nextVariantState
        };

        return {
          ...state,
          [message.route]: {
            variants: nextVariants,
            aggregated: computeAggregatedDiagnostics(nextVariants)
          }
        };
      });

      setValidationQueue((queue) => {
        const next = [validationEntry, ...queue];
        return next.slice(0, 8);
      });
    };

    const readyListener: EventListener = () => handleReady();
    const marketingListener: EventListener = (event) => handleEvent(event as MessageEvent<string>);

    source.addEventListener("ready", readyListener);
    source.addEventListener("marketing-preview", marketingListener);
    source.onerror = handleError;

    return () => {
      source.removeEventListener("ready", readyListener);
      source.removeEventListener("marketing-preview", marketingListener);
      source.close();
    };
  }, []);

  const timelineEntries = useMemo(() => [liveEntry, ...history], [liveEntry, history]);

  const variants = useMemo(() => {
    const catalogEntries = Object.values(variantCatalog);
    if (!catalogEntries.length) {
      return [
        {
          key: "variant-baseline",
          label: "Baseline",
          persona: null,
          campaign: null,
          featureFlag: null
        } satisfies LivePreviewVariantDescriptor
      ];
    }
    return [...catalogEntries].sort((a, b) => a.label.localeCompare(b.label));
  }, [variantCatalog]);

  const baselineVariantKey = useMemo(() => {
    const baseline = variants.find(
      (variant) => !variant.persona && !variant.campaign && !variant.featureFlag
    );
    return baseline?.key ?? variants[0]?.key ?? "variant-baseline";
  }, [variants]);

  const clearValidationQueue = () => {
    setValidationQueue([]);
  };

  return {
    timelineEntries,
    connectionState,
    validationQueue,
    clearValidationQueue,
    routeValidation,
    routeDiagnostics,
    variants,
    baselineVariantKey
  };
};
