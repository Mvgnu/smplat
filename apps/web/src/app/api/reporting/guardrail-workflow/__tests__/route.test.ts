import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockFetchSummary = jest.fn();

jest.mock("@/server/reporting/guardrail-workflow-telemetry", () => ({
  fetchGuardrailWorkflowTelemetrySummary: (...args: Parameters<typeof mockFetchSummary>) =>
    mockFetchSummary(...args),
}));

class TestResponse {
  status: number;
  private readonly headerMap = new Map<string, string>();
  headers = {
    get: (name: string) => this.headerMap.get(name.toLowerCase()) ?? null,
    set: (name: string, value: string) => {
      this.headerMap.set(name.toLowerCase(), value);
    },
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
}

if (typeof globalThis.Response === "undefined") {
  (globalThis as typeof globalThis & { Response: typeof Response }).Response =
    TestResponse as unknown as typeof Response;
}

describe("GET /api/reporting/guardrail-workflow", () => {
  beforeEach(() => {
    jest.resetModules();
    mockFetchSummary.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const importRoute = async () => {
    const route = await import("../route");
    return route.GET;
  };

  it("returns telemetry summary without limit params", async () => {
    const summary = {
      totalEvents: 3,
      lastCapturedAt: "2025-01-01T00:00:00.000Z",
      actionCounts: [{ action: "attachment.upload", count: 2, lastOccurredAt: "2025-01-01T00:00:00.000Z" }],
      attachmentTotals: { upload: 2, remove: 0, copy: 0, tag: 0 },
      providerActivity: [],
    };
    mockFetchSummary.mockResolvedValue(summary);
    const GET = await importRoute();

    const response = await GET(createRequest("http://localhost/api/reporting/guardrail-workflow"));

    expect(mockFetchSummary).toHaveBeenCalledWith(undefined);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(summary);
  });

  it("respects explicit limit query params", async () => {
    const emptySummary = {
      totalEvents: 0,
      lastCapturedAt: null,
      actionCounts: [],
      attachmentTotals: { upload: 0, remove: 0, copy: 0, tag: 0 },
      providerActivity: [],
    };
    mockFetchSummary.mockResolvedValue(emptySummary);
    const GET = await importRoute();

    await GET(createRequest("http://localhost/api/reporting/guardrail-workflow?limit=123"));

    expect(mockFetchSummary).toHaveBeenCalledWith(123);
  });

  it("returns 500 when fetching summary fails", async () => {
    mockFetchSummary.mockRejectedValue(new Error("boom"));
    const GET = await importRoute();

    const response = await GET(createRequest("http://localhost/api/reporting/guardrail-workflow"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to load guardrail workflow telemetry summary",
    });
  });
});

function createRequest(url: string): Request {
  return {
    method: "GET",
    url,
    headers: new Headers(),
  } as unknown as Request;
}
