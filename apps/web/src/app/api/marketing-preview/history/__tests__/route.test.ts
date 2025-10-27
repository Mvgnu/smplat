import crypto from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import {
  persistSnapshotManifest,
  resetHistoryStore
} from "@/server/cms/history";
import type {
  MarketingPreviewSnapshot,
  MarketingPreviewSnapshotManifest,
  MarketingPreviewTimelineRouteSummary
} from "@/server/cms/preview/types";

const mockGetMarketingPreviewNotes = jest.fn();

jest.mock("@/server/cms/preview/notes", () => {
  const originalModule = jest.requireActual("@/server/cms/preview/notes");
  return {
    ...originalModule,
    getMarketingPreviewNotes: (...args: unknown[]) => mockGetMarketingPreviewNotes(...args)
  };
});

class TestResponse {
  status: number;
  private readonly headerMap = new Map<string, string>();
  headers = {
    get: (name: string) => this.headerMap.get(name.toLowerCase()) ?? null,
    set: (name: string, value: string) => {
      this.headerMap.set(name.toLowerCase(), value);
    }
  };
  private readonly body: unknown;

  constructor(body: unknown, init?: ResponseInit) {
    this.status = init?.status ?? 200;
    this.body = body;
    if (init?.headers && typeof init.headers === "object") {
      for (const [key, value] of Object.entries(init.headers as Record<string, string>)) {
        this.headers.set(key, value);
      }
    }
  }

  json = async () => this.body;

  static json(body: unknown, init?: ResponseInit) {
    return new TestResponse(body, init);
  }

  static redirect(input: string | URL, status = 302) {
    const response = new TestResponse(null, { status });
    response.headers.set("location", input.toString());
    return response;
  }
}

if (typeof globalThis.Response === "undefined") {
  (globalThis as typeof globalThis & { Response: typeof TestResponse }).Response =
    TestResponse as unknown as typeof Response;
}

const createSnapshot = (route: string, preview: boolean): MarketingPreviewSnapshot => ({
  route,
  preview,
  hero: undefined,
  title: preview ? `${route}-draft` : `${route}-published`,
  sectionCount: 2,
  blockKinds: ["hero"],
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
  blockKinds: overrides.blockKinds ?? ["hero"]
});

const createRequest = (url: string): Request => ({
  method: "GET",
  url
} as unknown as Request);

describe("marketing preview history GET", () => {
  beforeEach(() => {
    resetHistoryStore();
    mockGetMarketingPreviewNotes.mockResolvedValue([]);
  });

  afterEach(() => {
    resetHistoryStore();
    mockGetMarketingPreviewNotes.mockReset();
  });

  const importRoute = async () => {
    const routeModule = await import("../route");
    return routeModule;
  };

  it("returns paginated history enriched with note severity counts", async () => {
    const generatedAt = "2024-06-01T00:00:00.000Z";
    const manifest = createManifest(generatedAt, "history-a", "/campaigns");
    const summary = [createRouteSummary("/campaigns", { diffDetected: true })];
    persistSnapshotManifest(manifest, summary, 8);

    mockGetMarketingPreviewNotes.mockResolvedValueOnce([
      {
        id: crypto.randomUUID(),
        route: "/campaigns",
        generatedAt,
        author: "Analyst",
        body: "Investigate drift",
        severity: "warning",
        createdAt: "2024-06-01T00:05:00.000Z"
      },
      {
        id: crypto.randomUUID(),
        route: "/campaigns",
        generatedAt,
        author: "Analyst",
        body: "Blocking issue",
        severity: "blocker",
        createdAt: "2024-06-01T00:06:00.000Z"
      }
    ]);

    const { GET } = await importRoute();
    const response = await GET(createRequest("http://localhost/api/marketing-preview/history?limit=5"));
    const payload = (await response.json()) as {
      total: number;
      entries: Array<{
        id: string;
        notes?: { severityCounts: Record<string, number> };
      }>;
    };

    expect(payload.total).toBe(1);
    expect(payload.entries).toHaveLength(1);
    const [entry] = payload.entries;
    expect(entry.id).toBe("history-a");
    expect(entry.notes?.severityCounts.warning).toBe(1);
    expect(entry.notes?.severityCounts.blocker).toBe(1);
  });

  it("applies severity filters before pagination", async () => {
    const firstGeneratedAt = "2024-06-02T00:00:00.000Z";
    const secondGeneratedAt = "2024-06-03T00:00:00.000Z";

    persistSnapshotManifest(createManifest(firstGeneratedAt, "first", "/alpha"), [createRouteSummary("/alpha")], 8);
    persistSnapshotManifest(createManifest(secondGeneratedAt, "second", "/beta"), [createRouteSummary("/beta")], 8);

    mockGetMarketingPreviewNotes.mockResolvedValueOnce([
      {
        id: crypto.randomUUID(),
        route: "/alpha",
        generatedAt: firstGeneratedAt,
        body: "Info note",
        severity: "info",
        createdAt: "2024-06-02T00:01:00.000Z"
      }
    ]);

    const { GET } = await importRoute();
    const response = await GET(
      createRequest("http://localhost/api/marketing-preview/history?limit=5&severity=info")
    );
    const payload = (await response.json()) as { total: number; entries: Array<{ id: string }> };

    expect(payload.total).toBe(1);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]?.id).toBe("first");
  });
});
