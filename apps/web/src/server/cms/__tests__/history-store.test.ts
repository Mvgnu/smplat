import crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  fetchSnapshotHistory,
  persistSnapshotManifest,
  resetHistoryStore,
  __internal
} from "../history/store";
import type {
  MarketingPreviewSnapshot,
  MarketingPreviewSnapshotManifest,
  MarketingPreviewTimelineRouteSummary
} from "../preview/types";

const createSnapshot = (route: string, preview: boolean): MarketingPreviewSnapshot => ({
  route,
  preview,
  hero: undefined,
  title: preview ? `${route}-draft` : `${route}-published`,
  sectionCount: 2,
  blockKinds: ["hero", "content"],
  metrics: undefined,
  markup: `<div data-route="${route}" data-preview="${preview}"></div>`
});

const createManifest = (
  generatedAt: string,
  label?: string,
  route = "/campaigns"
): MarketingPreviewSnapshotManifest => ({
  generatedAt,
  label,
  snapshots: [createSnapshot(route, false), createSnapshot(route, true)]
});

const createRouteSummary = (
  route: string,
  overrides: Partial<MarketingPreviewTimelineRouteSummary> = {}
): MarketingPreviewTimelineRouteSummary => ({
  route,
  hasDraft: overrides.hasDraft ?? true,
  hasPublished: overrides.hasPublished ?? true,
  diffDetected: overrides.diffDetected ?? false,
  sectionCount: overrides.sectionCount ?? 2,
  blockKinds: overrides.blockKinds ?? ["hero", "content"]
});

describe("marketing preview history store", () => {
  beforeEach(() => {
    resetHistoryStore();
  });

  afterEach(() => {
    resetHistoryStore();
  });

  it("persists manifests and retrieves them in reverse chronological order", () => {
    const older = createManifest("2024-01-01T00:00:00.000Z", "older", "/campaigns");
    const newer = createManifest("2024-02-02T00:00:00.000Z", "newer", "/campaigns");

    persistSnapshotManifest(older, [createRouteSummary("/campaigns")], 8);
    persistSnapshotManifest(newer, [createRouteSummary("/campaigns")], 8);

    const history = fetchSnapshotHistory(8);

    expect(history).toHaveLength(2);
    expect(history[0]?.generatedAt).toBe(newer.generatedAt);
    expect(history[1]?.generatedAt).toBe(older.generatedAt);
    expect(history[0]?.snapshots[0]?.route).toBe("/campaigns");
  });

  it("trims manifests beyond the configured history limit", () => {
    const first = createManifest("2024-01-01T00:00:00.000Z", "first", "/alpha");
    const second = createManifest("2024-01-02T00:00:00.000Z", "second", "/beta");

    persistSnapshotManifest(first, [createRouteSummary("/alpha")], 1);
    persistSnapshotManifest(second, [createRouteSummary("/beta")], 1);

    const history = fetchSnapshotHistory(8);

    expect(history).toHaveLength(1);
    expect(history[0]?.label).toBe("second");
    expect(history[0]?.snapshots.some((snapshot) => snapshot.route === "/beta")).toBe(true);
  });

  it("stores privacy-preserving hashes for route analytics", () => {
    const route = "/governance";
    const manifest = createManifest("2024-03-03T00:00:00.000Z", "hash-check", route);

    persistSnapshotManifest(manifest, [createRouteSummary(route)], 8);

    const database = __internal.openDatabase();
    const row = database
      .prepare(
        `SELECT route, route_hash FROM snapshot_routes WHERE manifest_id = ? LIMIT 1`
      )
      .get("hash-check");

    expect(row).toBeDefined();
    expect(row.route).toBe(route);
    expect(row.route_hash).toBe(
      crypto.createHash("sha256").update(route).digest("hex")
    );
    expect(row.route_hash).not.toBe(route);
  });
});
