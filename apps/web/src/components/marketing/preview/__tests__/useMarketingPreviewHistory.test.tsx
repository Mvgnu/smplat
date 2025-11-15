// meta: test: useMarketingPreviewHistory
// meta: feature: marketing-preview-cockpit

import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type {
  MarketingPreviewSnapshot,
  MarketingPreviewTimelineEntry
} from "@/server/cms/preview";
import type { MarketingPreviewHistoryTimelineEntry } from "../useMarketingPreviewHistory";
import { useMarketingPreviewHistory } from "../useMarketingPreviewHistory";

const createSnapshot = (overrides: Partial<MarketingPreviewSnapshot> = {}): MarketingPreviewSnapshot => ({
  route: "marketing/home",
  preview: overrides.preview ?? false,
  hero: undefined,
  title: overrides.title ?? "Home",
  sectionCount: overrides.sectionCount ?? 1,
  blockKinds: overrides.blockKinds ?? ["hero"],
  metrics: undefined,
  markup: overrides.markup ?? "<div />"
});

const initialTimelineEntry: MarketingPreviewTimelineEntry = {
  id: "initial",
  generatedAt: "2024-05-01T00:00:00.000Z",
  label: "Initial",
  routes: [
    {
      route: "marketing/home",
      hasDraft: true,
      hasPublished: true,
      diffDetected: false,
      sectionCount: 1,
      blockKinds: ["hero"]
    }
  ],
  snapshots: {
    published: [createSnapshot()],
    draft: [createSnapshot({ preview: true, title: "Home Draft" })]
  }
};

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });

  const TestQueryClientProvider = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  TestQueryClientProvider.displayName = "TestQueryClientProvider";

  return TestQueryClientProvider;
};

describe("useMarketingPreviewHistory", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    window.localStorage.clear();
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true
    });
  });

  test("fetches persisted history entries and exposes aggregates", async () => {
    const responsePayload = {
      total: 2,
      limit: 10,
      offset: 0,
      entries: [
        {
          id: "persisted-1",
          generatedAt: "2024-05-02T00:00:00.000Z",
          label: "Capture 1",
          manifest: {
            generatedAt: "2024-05-02T00:00:00.000Z",
            snapshots: [createSnapshot(), createSnapshot({ preview: true })]
          },
          routes: [
            {
              route: "marketing/home",
              routeHash: "abc123",
              diffDetected: true,
              hasDraft: true,
              hasPublished: true,
              sectionCount: 1,
              blockKinds: ["hero"]
            }
          ],
          aggregates: {
            totalRoutes: 1,
            diffDetectedRoutes: 1,
            draftRoutes: 1,
            publishedRoutes: 1
          },
          governance: {
            totalActions: 2,
            actionsByKind: { promote: 1, fallback: 1 },
            lastActionAt: "2024-05-02T00:05:00.000Z"
          },
          notes: {
            total: 1,
            severityCounts: { info: 0, warning: 1, blocker: 0 }
          },
          liveDeltas: [],
          remediations: [],
          rehearsals: [],
          noteRevisions: []
        },
        {
          id: "persisted-0",
          generatedAt: "2024-05-01T12:00:00.000Z",
          label: null,
          manifest: {
            generatedAt: "2024-05-01T12:00:00.000Z",
            snapshots: [createSnapshot({ title: "Home - older" })]
          },
          routes: [
            {
              route: "marketing/about",
              routeHash: "def456",
              diffDetected: false,
              hasDraft: false,
              hasPublished: true,
              sectionCount: 2,
              blockKinds: ["hero", "faq"]
            }
          ],
          aggregates: {
            totalRoutes: 1,
            diffDetectedRoutes: 0,
            draftRoutes: 0,
            publishedRoutes: 1
          },
          governance: {
            totalActions: 0,
            actionsByKind: {},
            lastActionAt: null
          },
          notes: {
            total: 0,
            severityCounts: { info: 0, warning: 0, blocker: 0 }
          },
          liveDeltas: [],
          remediations: [],
          rehearsals: [],
          noteRevisions: []
        }
      ],
      analytics: {
        regressionVelocity: {
          averagePerHour: -1.5,
          currentPerHour: -1,
          sampleSize: 2,
          confidence: 0.75
        },
        severityMomentum: {
          info: -0.25,
          warning: 0,
          blocker: 0,
          overall: -0.07,
          sampleSize: 2
        },
        timeToGreen: {
          forecastAt: "2024-05-03T00:00:00.000Z",
          forecastHours: 24,
          slopePerHour: -1.5,
          confidence: 0.65,
          sampleSize: 2
        },
        recommendations: []
      }
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responsePayload
    } as Response);

    const { result } = renderHook(
      () => useMarketingPreviewHistory({ initialEntries: [initialTimelineEntry] }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0].id).toBe("persisted-1");
    expect(result.current.entries[0].aggregates.diffDetectedRoutes).toBe(1);
    expect(result.current.availableRoutes).toEqual([
      "marketing/about",
      "marketing/home"
    ]);
    expect(result.current.analytics.timeToGreen.forecastHours).toBe(24);
    expect(result.current.analytics.regressionVelocity.sampleSize).toBe(2);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/marketing-preview/history"),
      expect.objectContaining({ method: "GET" })
    );
  });

  test("replays cached history when offline and fetch fails", async () => {
    const cachedEntry: MarketingPreviewHistoryTimelineEntry = {
      ...initialTimelineEntry,
      id: "cached",
      generatedAt: "2024-04-30T00:00:00.000Z",
      aggregates: {
        totalRoutes: 1,
        diffDetectedRoutes: 0,
        draftRoutes: 1,
        publishedRoutes: 1
      },
      governance: {
        totalActions: 0,
        actionsByKind: {},
        lastActionAt: null
      },
      notes: {
        total: 0,
        severityCounts: { info: 0, warning: 0, blocker: 0 }
      },
      liveDeltas: [],
      remediations: [],
      rehearsals: [],
      noteRevisions: []
    };

    const cachedPayload = {
      params: { limit: 10, offset: 0 },
      payload: {
        entries: [cachedEntry],
        total: 1,
        limit: 10,
        offset: 0,
        analytics: {
          regressionVelocity: {
            averagePerHour: 0,
            currentPerHour: 0,
            sampleSize: 1,
            confidence: 0
          },
          severityMomentum: {
            info: 0,
            warning: 0,
            blocker: 0,
            overall: 0,
            sampleSize: 1
          },
          timeToGreen: {
            forecastAt: null,
            forecastHours: null,
            slopePerHour: null,
            confidence: 0,
            sampleSize: 1
          },
          recommendations: []
        }
      },
      cachedAt: "2024-05-01T00:00:00.000Z"
    };

    window.localStorage.setItem(
      "marketing-preview-history-cache-v3",
      JSON.stringify(cachedPayload)
    );

    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: false
    });

    global.fetch = jest.fn().mockRejectedValue(new Error("network down"));

    const { result } = renderHook(
      () => useMarketingPreviewHistory({ initialEntries: [initialTimelineEntry] }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.entries[0].id).toBe("cached"));

    expect(result.current.isUsingCache).toBe(true);
    expect(result.current.isOffline).toBe(true);
    expect(result.current.analytics.regressionVelocity.sampleSize).toBe(1);
    expect(global.fetch).toHaveBeenCalled();
    expect(result.current.entries[0].liveDeltas).toEqual([]);
    expect(result.current.entries[0].remediations).toEqual([]);
    expect(result.current.entries[0].noteRevisions).toEqual([]);
  });

  test("applies filters and resets pagination", async () => {
    const responsePayload = {
      total: 4,
      limit: 2,
      offset: 0,
      entries: [
        {
          id: "persisted-filtered",
          generatedAt: "2024-05-02T00:00:00.000Z",
          label: "Filtered",
          manifest: {
            generatedAt: "2024-05-02T00:00:00.000Z",
            snapshots: [createSnapshot()]
          },
          routes: [
            {
              route: "marketing/home",
              routeHash: "abc123",
              diffDetected: false,
              hasDraft: true,
              hasPublished: true,
              sectionCount: 1,
              blockKinds: ["hero"]
            }
          ],
          aggregates: {
            totalRoutes: 1,
            diffDetectedRoutes: 0,
            draftRoutes: 1,
            publishedRoutes: 1
          },
          governance: {
            totalActions: 0,
            actionsByKind: {},
            lastActionAt: null
          },
          notes: {
            total: 0,
            severityCounts: { info: 0, warning: 0, blocker: 0 }
          },
          liveDeltas: [],
          remediations: [],
          rehearsals: [],
          noteRevisions: []
        }
      ],
      analytics: {
        regressionVelocity: {
          averagePerHour: 0,
          currentPerHour: 0,
          sampleSize: 1,
          confidence: 0
        },
        severityMomentum: {
          info: 0,
          warning: 0,
          blocker: 0,
          overall: 0,
          sampleSize: 1
        },
        timeToGreen: {
          forecastAt: null,
          forecastHours: null,
          slopePerHour: null,
          confidence: 0,
          sampleSize: 1
        },
        recommendations: []
      }
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responsePayload
    } as Response);
    global.fetch = fetchMock;

    const { result } = renderHook(
      () => useMarketingPreviewHistory({ initialEntries: [initialTimelineEntry], initialLimit: 2 }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.nextPage();
    });

    expect(result.current.page).toBe(1);

    act(() => {
      result.current.setRouteFilter("marketing/home");
    });

    await waitFor(() => expect(result.current.page).toBe(0));
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("route=marketing%2Fhome"),
      expect.objectContaining({ method: "GET" })
    );
  });

  test("toggles rehearsal action mode filter", async () => {
    const responsePayload = {
      total: 1,
      limit: 10,
      offset: 0,
      entries: [
        {
          id: "persisted-rehearsal",
          generatedAt: "2024-05-03T00:00:00.000Z",
          label: "Rehearsal",
          manifest: {
            generatedAt: "2024-05-03T00:00:00.000Z",
            snapshots: [createSnapshot()]
          },
          routes: [
            {
              route: "marketing/home",
              routeHash: "ghi789",
              diffDetected: false,
              hasDraft: true,
              hasPublished: true,
              sectionCount: 1,
              blockKinds: ["hero"]
            }
          ],
          aggregates: {
            totalRoutes: 1,
            diffDetectedRoutes: 0,
            draftRoutes: 1,
            publishedRoutes: 1
          },
          governance: {
            totalActions: 0,
            actionsByKind: {},
            lastActionAt: null
          },
          notes: {
            total: 0,
            severityCounts: { info: 0, warning: 0, blocker: 0 }
          },
          liveDeltas: [],
          remediations: [],
          rehearsals: [
            {
              id: "reh-1",
              manifestGeneratedAt: "2024-05-03T00:00:00.000Z",
              scenarioFingerprint: "scenario::1",
              expectedDeltas: 2,
              operatorHash: "hash",
              payloadHash: "payload::hash",
              recordedAt: "2024-05-03T00:01:00.000Z",
              verdict: "pending",
              evaluatedAt: null,
              actualDeltas: null,
              diff: null,
              failureReasons: null,
              comparison: null
            }
          ],
          noteRevisions: []
        }
      ],
      analytics: {
        regressionVelocity: {
          averagePerHour: 0,
          currentPerHour: 0,
          sampleSize: 1,
          confidence: 0
        },
        severityMomentum: {
          info: 0,
          warning: 0,
          blocker: 0,
          overall: 0,
          sampleSize: 1
        },
        timeToGreen: {
          forecastAt: null,
          forecastHours: null,
          slopePerHour: null,
          confidence: 0,
          sampleSize: 1
        },
        recommendations: []
      }
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responsePayload
    } as Response);
    global.fetch = fetchMock;

    const { result } = renderHook(
      () => useMarketingPreviewHistory({ initialEntries: [initialTimelineEntry] }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setActionModeFilter("rehearsal");
    });

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining("actionMode=rehearsal"),
      expect.objectContaining({ method: "GET" })
    ));

    act(() => {
      result.current.setActionModeFilter("all");
    });

    await waitFor(() => expect(result.current.filters.mode).toBeUndefined());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
