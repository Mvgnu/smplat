// meta: test: history-analytics
// meta: feature: marketing-preview-cockpit

import { buildHistoryAnalytics } from "../history/analytics";
import type { MarketingPreviewHistoryEntry } from "../history";

describe("buildHistoryAnalytics", () => {
  const baseEntry = (overrides: Partial<MarketingPreviewHistoryEntry>): MarketingPreviewHistoryEntry => ({
    id: overrides.id ?? `entry-${overrides.generatedAt ?? "base"}`,
    generatedAt: overrides.generatedAt ?? new Date().toISOString(),
    label: null,
    manifest: {
      generatedAt: overrides.generatedAt ?? new Date().toISOString(),
      label: null,
      snapshots: []
    },
    routes:
      overrides.routes ??
      [
        {
          route: "/",
          routeHash: "hash",
          diffDetected: false,
          hasDraft: true,
          hasPublished: true,
          sectionCount: 1,
          blockKinds: ["hero"]
        }
      ],
    aggregates:
      overrides.aggregates ??
      {
        totalRoutes: 1,
        diffDetectedRoutes: 0,
        draftRoutes: 1,
        publishedRoutes: 1
      },
    governance: overrides.governance ?? { totalActions: 0, actionsByKind: {}, lastActionAt: null },
    liveDeltas: overrides.liveDeltas ?? [],
    remediations: overrides.remediations ?? [],
    noteRevisions: overrides.noteRevisions ?? [],
    notes: overrides.notes
  });

  it("returns zeroed analytics when insufficient data", () => {
    const analytics = buildHistoryAnalytics([baseEntry({})]);

    expect(analytics.regressionVelocity.averagePerHour).toBe(0);
    expect(analytics.timeToGreen.forecastAt).toBeNull();
    expect(analytics.recommendations).toHaveLength(0);
  });

  it("calculates regression velocity, severity momentum, and recommendations", () => {
    const entries: MarketingPreviewHistoryEntry[] = [
      baseEntry({
        id: "a",
        generatedAt: "2024-01-01T00:00:00.000Z",
        aggregates: {
          totalRoutes: 3,
          diffDetectedRoutes: 6,
          draftRoutes: 3,
          publishedRoutes: 3
        },
        notes: {
          total: 3,
          severityCounts: { info: 2, warning: 1, blocker: 0 }
        }
      }),
      baseEntry({
        id: "b",
        generatedAt: "2024-01-01T02:00:00.000Z",
        aggregates: {
          totalRoutes: 3,
          diffDetectedRoutes: 3,
          draftRoutes: 3,
          publishedRoutes: 3
        },
        notes: {
          total: 2,
          severityCounts: { info: 1, warning: 1, blocker: 0 }
        },
        remediations: [
          {
            id: "r-1",
            manifestGeneratedAt: "2024-01-01T02:00:00.000Z",
            route: "/",
            action: "reset",
            fingerprint: "schema:missing-field",
            summary: null,
            collection: null,
            docId: null,
            payloadHash: "hash-1",
            recordedAt: "2024-01-01T02:00:00.000Z"
          }
        ]
      }),
      baseEntry({
        id: "c",
        generatedAt: "2024-01-01T05:00:00.000Z",
        aggregates: {
          totalRoutes: 3,
          diffDetectedRoutes: 1,
          draftRoutes: 3,
          publishedRoutes: 3
        },
        notes: {
          total: 1,
          severityCounts: { info: 1, warning: 0, blocker: 0 }
        },
        remediations: [
          {
            id: "r-2",
            manifestGeneratedAt: "2024-01-01T05:00:00.000Z",
            route: "/pricing",
            action: "reset",
            fingerprint: "schema:missing-field",
            summary: null,
            collection: null,
            docId: null,
            payloadHash: "hash-2",
            recordedAt: "2024-01-01T05:00:00.000Z"
          }
        ]
      })
    ];

    const analytics = buildHistoryAnalytics(entries);

    expect(analytics.regressionVelocity.averagePerHour).toBeLessThan(0);
    expect(analytics.regressionVelocity.currentPerHour).toBeLessThan(0);
    expect(analytics.severityMomentum.info).toBeLessThan(0);
    expect(analytics.severityMomentum.warning).toBeLessThanOrEqual(0);
    expect(analytics.timeToGreen.forecastHours).toBeGreaterThan(0);
    expect(analytics.timeToGreen.confidence).toBeGreaterThan(0);
    expect(analytics.recommendations).toHaveLength(1);
    expect(analytics.recommendations[0]?.fingerprint).toBe("schema:missing-field");
    expect(analytics.recommendations[0]?.occurrences).toBe(2);
  });
});
