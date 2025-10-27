import crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  fetchSnapshotHistory,
  persistSnapshotManifest,
  querySnapshotHistory,
  recordGovernanceAction,
  recordLivePreviewDelta,
  recordRemediationAction,
  recordNoteRevision,
  resetHistoryStore,
  createHistoryHash,
  __internal
} from "../history";
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

  it("queries history with aggregates and governance metadata", () => {
    const manifest = createManifest("2024-04-04T00:00:00.000Z", "queryable", "/campaigns");
    const routes = [
      createRouteSummary("/campaigns", { diffDetected: true }),
      createRouteSummary("/blog", { hasDraft: false })
    ];

    persistSnapshotManifest(manifest, routes, 8);

    recordGovernanceAction({
      id: crypto.randomUUID(),
      manifestId: "queryable",
      actorHash: createHistoryHash("person@example.com"),
      actionKind: "approve",
      metadata: { route: "/campaigns" },
      createdAt: "2024-04-04T00:10:00.000Z"
    });

    const result = querySnapshotHistory({ limit: 5 });

    expect(result.total).toBeGreaterThanOrEqual(1);
    const entry = result.entries.find((item) => item.id === "queryable");
    expect(entry).toBeDefined();
    expect(entry?.aggregates.totalRoutes).toBe(2);
    expect(entry?.aggregates.diffDetectedRoutes).toBe(1);
    expect(entry?.aggregates.draftRoutes).toBe(1);
    expect(entry?.aggregates.publishedRoutes).toBe(2);
    expect(entry?.governance.totalActions).toBe(1);
    expect(entry?.governance.actionsByKind.approve).toBe(1);
    expect(entry?.governance.lastActionAt).toBe("2024-04-04T00:10:00.000Z");
    expect(entry?.liveDeltas).toEqual([]);
    expect(entry?.remediations).toEqual([]);
    expect(entry?.noteRevisions).toEqual([]);
  });

  it("applies route and variant filters to query results", () => {
    const manifestA = createManifest("2024-05-05T00:00:00.000Z", "filter-a", "/alpha");
    const manifestB = createManifest("2024-05-06T00:00:00.000Z", "filter-b", "/beta");

    persistSnapshotManifest(
      manifestA,
      [
        createRouteSummary("/alpha", { hasDraft: true, hasPublished: false })
      ],
      8
    );
    persistSnapshotManifest(
      manifestB,
      [
        createRouteSummary("/beta", { hasDraft: false, hasPublished: true })
      ],
      8
    );

    const draftOnly = querySnapshotHistory({ limit: 5, variant: "draft" });
    expect(draftOnly.entries.some((entry) => entry.id === "filter-a")).toBe(true);
    expect(draftOnly.entries.some((entry) => entry.id === "filter-b")).toBe(false);

    const betaOnly = querySnapshotHistory({ limit: 5, route: "/beta" });
    expect(betaOnly.entries).toHaveLength(1);
    expect(betaOnly.entries[0]?.id).toBe("filter-b");
  });

  it("records live preview deltas with idempotent hashes", () => {
    const manifest = createManifest("2024-06-06T00:00:00.000Z", "live-delta", "/campaigns");
    persistSnapshotManifest(manifest, [createRouteSummary("/campaigns")], 8);

    const payload = {
      route: "/campaigns",
      slug: "/campaigns",
      label: "Campaigns",
      environment: "preview",
      generatedAt: "2024-06-06T00:05:00.000Z",
      markup: "<div>campaigns</div>",
      blockKinds: ["hero"],
      sectionCount: 1,
      variant: {
        key: "variant-baseline",
        label: "Baseline",
        persona: null,
        campaign: null,
        featureFlag: null
      },
      collection: "pages",
      docId: "campaigns",
      metrics: null,
      hero: null,
      validation: {
        ok: false,
        warnings: ["Hero missing CTA"],
        blocks: [
          {
            kind: "hero",
            valid: false,
            errors: ["cta"],
            warnings: [],
            trace: { lexicalKey: "hero-1" }
          }
        ]
      },
      diagnostics: { summary: { totalBlocks: 1, invalidBlocks: 1 } }
    } satisfies Parameters<typeof recordLivePreviewDelta>[0]["payload"];

    recordLivePreviewDelta({
      manifestGeneratedAt: manifest.generatedAt,
      generatedAt: payload.generatedAt,
      route: payload.route,
      variantKey: payload.variant.key,
      payload
    });

    // Duplicate should be ignored.
    recordLivePreviewDelta({
      manifestGeneratedAt: manifest.generatedAt,
      generatedAt: payload.generatedAt,
      route: payload.route,
      variantKey: payload.variant.key,
      payload
    });

    const result = querySnapshotHistory({ limit: 5, route: "/campaigns" });
    const entry = result.entries.find((item) => item.id === "live-delta");
    expect(entry?.liveDeltas).toHaveLength(1);
    expect(entry?.liveDeltas[0]?.payload.route).toBe("/campaigns");
    expect(entry?.liveDeltas[0]?.payloadHash).toBeDefined();
  });

  it("records remediation actions and trims with manifests", () => {
    const first = createManifest("2024-06-07T00:00:00.000Z", "remed-first", "/campaigns");
    const second = createManifest("2024-06-08T00:00:00.000Z", "remed-second", "/campaigns");

    persistSnapshotManifest(first, [createRouteSummary("/campaigns")], 1);
    recordRemediationAction({
      manifestGeneratedAt: first.generatedAt,
      route: "/campaigns",
      action: "reset",
      fingerprint: null,
      summary: { totalBlocks: 3, invalidBlocks: 1 },
      collection: "pages",
      docId: "campaigns",
      occurredAt: "2024-06-07T00:05:00.000Z"
    });

    // Persisting second manifest with limit=1 should trim the first manifest and its artifacts.
    persistSnapshotManifest(second, [createRouteSummary("/campaigns")], 1);

    const result = querySnapshotHistory({ limit: 5 });
    const remaining = result.entries.find((item) => item.id === "remed-second");
    expect(remaining).toBeDefined();
    expect(remaining?.remediations).toHaveLength(0);
  });

  it("records note revisions with hashed authors", () => {
    const manifest = createManifest("2024-06-09T00:00:00.000Z", "notes", "/campaigns");
    persistSnapshotManifest(manifest, [createRouteSummary("/campaigns")], 8);

    recordNoteRevision({
      noteId: "note-1",
      manifestGeneratedAt: manifest.generatedAt,
      route: "/campaigns",
      severity: "warning",
      body: "Check CTA alignment",
      author: "operator@example.com",
      recordedAt: "2024-06-09T00:15:00.000Z"
    });

    const result = querySnapshotHistory({ limit: 5, route: "/campaigns" });
    const entry = result.entries.find((item) => item.id === "notes");
    expect(entry?.noteRevisions).toHaveLength(1);
    const revision = entry?.noteRevisions[0];
    expect(revision?.authorHash).toBe(createHistoryHash("operator@example.com"));
    expect(revision?.severity).toBe("warning");
  });
});
