import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

import {
  createHistoryHash,
  persistSnapshotManifest,
  querySnapshotHistory,
  resetHistoryStore
} from "@/server/cms/history";
import type {
  MarketingPreviewSnapshot,
  MarketingPreviewSnapshotManifest,
  MarketingPreviewTimelineRouteSummary
} from "@/server/cms/preview/types";

const createSnapshot = (route: string, preview: boolean): MarketingPreviewSnapshot => ({
  route,
  preview,
  hero: undefined,
  title: preview ? `${route}-draft` : `${route}-published`,
  sectionCount: 1,
  blockKinds: ["hero"],
  metrics: undefined,
  markup: `<div data-route="${route}" data-preview="${preview}"></div>`
});

const createManifest = (
  generatedAt: string,
  label: string,
  route: string
): MarketingPreviewSnapshotManifest => ({
  generatedAt,
  label,
  snapshots: [createSnapshot(route, false), createSnapshot(route, true)]
});

const createRouteSummary = (
  route: string
): MarketingPreviewTimelineRouteSummary => ({
  route,
  hasDraft: true,
  hasPublished: true,
  diffDetected: false,
  sectionCount: 1,
  blockKinds: ["hero"]
});

const createRequest = (body: unknown, headers?: Record<string, string>): Request => {
  const headerMap = new Map<string, string>();
  Object.entries(headers ?? {}).forEach(([key, value]) => {
    headerMap.set(key.toLowerCase(), value);
  });
  return {
    method: "POST",
    url: "http://localhost/api/marketing-preview/history/governance",
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null
    },
    json: async () => body
  } as unknown as Request;
};

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

describe("marketing preview governance POST", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    resetHistoryStore();
    process.env = {
      ...originalEnv,
      PAYLOAD_LIVE_PREVIEW_SECRET: "preview-secret"
    };
    const manifest = createManifest("2024-07-01T00:00:00.000Z", "ledger", "/campaigns");
    persistSnapshotManifest(manifest, [createRouteSummary("/campaigns")], 8);
  });

  afterEach(() => {
    resetHistoryStore();
    process.env = originalEnv;
  });

  const importRoute = async () => {
    const routeModule = await import("../route");
    return routeModule;
  };

  it("rejects unauthorized requests", async () => {
    const { POST } = await importRoute();
    const response = await POST(createRequest({ manifestId: "ledger", actionKind: "approve" }));
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toBe("Unauthorized");
  });

  it("records governance actions with hashed actors", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      createRequest(
        { manifestId: "ledger", actionKind: "approve", actorId: "governor@example.com" },
        { "x-preview-signature": "preview-secret" }
      )
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as {
      action: { manifestId: string; actorHash: string | null };
    };
    expect(payload.action.manifestId).toBe("ledger");
    expect(payload.action.actorHash).toBe(createHistoryHash("governor@example.com"));

    const history = querySnapshotHistory({ limit: 5 });
    const entry = history.entries.find((item) => item.id === "ledger");
    expect(entry?.governance.totalActions).toBeGreaterThanOrEqual(1);
    expect(entry?.governance.actionsByKind.approve).toBeGreaterThanOrEqual(1);
  });
});
