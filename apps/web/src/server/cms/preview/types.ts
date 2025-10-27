export type SnapshotMetrics = {
  label?: string;
  values: Array<{ label?: string; value?: string }>;
};

import type { PageDocument } from "../types";

export type MarketingPreviewSnapshot = {
  route: string;
  preview: boolean;
  hero?: PageDocument["hero"];
  title?: string;
  sectionCount: number;
  blockKinds: string[];
  metrics?: SnapshotMetrics;
  markup: string;
};

export type MarketingPreviewSnapshotManifest = {
  generatedAt: string;
  snapshots: MarketingPreviewSnapshot[];
  label?: string;
};

export type MarketingPreviewTimelineRouteSummary = {
  route: string;
  hasDraft: boolean;
  hasPublished: boolean;
  diffDetected: boolean;
  sectionCount: number;
  blockKinds: string[];
};

export type MarketingPreviewTimelineEntry = {
  id: string;
  generatedAt: string;
  label?: string;
  routes: MarketingPreviewTimelineRouteSummary[];
  snapshots: Record<"published" | "draft", MarketingPreviewSnapshot[]>;
};

export type MarketingPreviewTimeline = {
  current: MarketingPreviewTimelineEntry;
  history: MarketingPreviewTimelineEntry[];
};
