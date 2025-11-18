import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockReadEvents = jest.fn();

jest.mock("@/server/telemetry/guardrail-workflow-storage", () => ({
  readGuardrailWorkflowEvents: (...args: Parameters<typeof mockReadEvents>) => mockReadEvents(...args),
}));

class TestResponse {
  status: number;
  headers = new Headers();
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
  text = async () => (typeof this.body === "string" ? this.body : JSON.stringify(this.body));

  static json(body: unknown, init?: ResponseInit) {
    return new TestResponse(body, init);
  }
}

if (typeof globalThis.Response === "undefined") {
  (globalThis as typeof globalThis & { Response: typeof Response }).Response =
    TestResponse as unknown as typeof Response;
}

describe("GET /api/telemetry/guardrail-workflow/export", () => {
  beforeEach(() => {
    jest.resetModules();
    mockReadEvents.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const importRoute = async () => {
    const route = await import("../route");
    return route.GET;
  };

  it("streams NDJSON when events exist", async () => {
    const events = [
      { name: "guardrail.workflow", workflowAction: "attachment.upload", recordedAt: "2025-01-01T00:00:00.000Z" },
      { name: "guardrail.workflow", workflowAction: "note.update", recordedAt: "2025-01-01T00:05:00.000Z" },
    ];
    mockReadEvents.mockResolvedValue(events);
    const GET = await importRoute();

    const response = await GET(createRequest("http://localhost/api/telemetry/guardrail-workflow/export"));

    expect(response.status).toBe(200);
    expect(mockReadEvents).toHaveBeenCalledWith(undefined);
    const payload = await response.text();
    expect(payload.trim().split("\n")).toHaveLength(2);
  });

  it("applies limit query parameter", async () => {
    mockReadEvents.mockResolvedValue([]);
    const GET = await importRoute();
    await GET(createRequest("http://localhost/api/telemetry/guardrail-workflow/export?limit=250"));
    expect(mockReadEvents).toHaveBeenCalledWith(250);
  });

  it("returns 404 when file has no events", async () => {
    mockReadEvents.mockResolvedValue([]);
    const GET = await importRoute();

    const response = await GET(createRequest("http://localhost/api/telemetry/guardrail-workflow/export"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "No guardrail workflow telemetry captured yet." });
  });

  it("returns 500 on unexpected errors", async () => {
    mockReadEvents.mockRejectedValue(new Error("boom"));
    const GET = await importRoute();

    const response = await GET(createRequest("http://localhost/api/telemetry/guardrail-workflow/export"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Unable to export guardrail workflow telemetry" });
  });
});

function createRequest(url: string): Request {
  return {
    method: "GET",
    url,
    headers: new Headers(),
  } as unknown as Request;
}
