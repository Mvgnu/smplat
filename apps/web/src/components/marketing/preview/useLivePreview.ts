import { useEffect, useMemo, useRef, useState } from "react";

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

export type LiveValidationBlock = {
  key?: string;
  kind?: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  fingerprint?: string;
  recoveryHints: string[];
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
  summary: LiveDiagnosticsPayload["summary"];
  normalizationWarnings: string[];
  sections: LiveDiagnosticsSection[];
  blocks: LiveValidationBlock[];
  delta: {
    invalidBlocks: number;
    warningBlocks: number;
  };
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

export type RouteDiagnosticsState = Record<
  string,
  {
    latest?: LiveDiagnosticsLedgerEntry;
    history: LiveDiagnosticsLedgerEntry[];
  }
>;

type UseLivePreviewResult = {
  timelineEntries: MarketingPreviewTimelineEntry[];
  connectionState: LivePreviewConnectionState;
  validationQueue: LiveValidationEntry[];
  clearValidationQueue: () => void;
  routeValidation: Record<string, LiveValidationEntry>;
  routeDiagnostics: RouteDiagnosticsState;
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
  previous?: LiveDiagnosticsLedgerEntry
): LiveDiagnosticsLedgerEntry => {
  const previousSummary = previous?.summary;
  const delta = {
    invalidBlocks: entry.diagnostics.summary.invalidBlocks - (previousSummary?.invalidBlocks ?? 0),
    warningBlocks: entry.diagnostics.summary.warningBlocks - (previousSummary?.warningBlocks ?? 0)
  };

  return {
    id: entry.id,
    route,
    receivedAt: entry.receivedAt,
    summary: entry.diagnostics.summary,
    normalizationWarnings: entry.diagnostics.normalizationWarnings,
    sections: entry.diagnostics.sections,
    blocks: entry.blocks,
    delta
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

export const useLivePreview = ({ current, history }: UseLivePreviewArgs): UseLivePreviewResult => {
  const [liveEntry, setLiveEntry] = useState<MarketingPreviewTimelineEntry>(current);
  const [connectionState, setConnectionState] = useState<LivePreviewConnectionState>("connecting");
  const [validationQueue, setValidationQueue] = useState<LiveValidationEntry[]>([]);
  const [routeValidation, setRouteValidation] = useState<Record<string, LiveValidationEntry>>({});
  const [routeDiagnostics, setRouteDiagnostics] = useState<RouteDiagnosticsState>({});
  const isMounted = useRef(true);

  useEffect(() => {
    setLiveEntry(current);
  }, [current]);

  useEffect(() => {
    setRouteValidation({});
    setValidationQueue([]);
    setRouteDiagnostics({});
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

      setRouteDiagnostics((state) => {
        const previous = state[message.route];
        const ledgerEntry = createDiagnosticsLedgerEntry(
          message.route,
          validationEntry,
          previous?.latest
        );
        const historyEntries = previous ? [ledgerEntry, ...previous.history] : [ledgerEntry];
        return {
          ...state,
          [message.route]: {
            latest: ledgerEntry,
            history: historyEntries.slice(0, 12)
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

  const clearValidationQueue = () => {
    setValidationQueue([]);
  };

  return {
    timelineEntries,
    connectionState,
    validationQueue,
    clearValidationQueue,
    routeValidation,
    routeDiagnostics
  };
};
