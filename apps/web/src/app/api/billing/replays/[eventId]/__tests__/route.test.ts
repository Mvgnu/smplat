import { describe, expect, it, jest } from "@jest/globals";

const mockHeaders = jest.fn();

jest.mock("next/headers", () => ({
  headers: () => mockHeaders(),
}));

const triggerProcessorReplay = jest.fn();

jest.mock("@/server/billing/replays", () => ({
  triggerProcessorReplay: (...args: unknown[]) => triggerProcessorReplay(...args),
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
  (globalThis as typeof globalThis & { Response: typeof TestResponse }).Response = TestResponse as unknown as typeof Response;
}

const createRequest = (url: string, body?: unknown) => {
  return {
    method: "POST",
    url,
    headers: {
      get: () => null,
    },
    json: async () => {
      if (body === undefined) {
        return {};
      }
      return body;
    },
  } as unknown as Request;
};

describe("POST /api/billing/replays/[eventId]", () => {
  const importRoute = async () => {
    const routeModule = await import("../route");
    return routeModule.POST;
  };

  it("forwards replay trigger responses", async () => {
    const POST = await importRoute();
    mockHeaders.mockReturnValue(new Headers({ "traceparent": "00-test" }));
    triggerProcessorReplay.mockResolvedValue({
      ok: true,
      status: 202,
      event: {
        id: "evt-123",
        provider: "stripe",
        externalId: "evt_123",
        correlationId: "inv_123",
        workspaceId: null,
        invoiceId: "inv_123",
        replayRequested: true,
        replayRequestedAt: "2024-01-01T00:00:00.000Z",
        replayAttempts: 1,
        replayedAt: null,
        lastReplayError: null,
        receivedAt: "2024-01-01T00:00:00.000Z",
        createdAt: "2024-01-01T00:00:00.000Z",
        status: "queued",
      },
    });

    const request = createRequest("http://localhost/api/billing/replays/evt-123", { force: true });

    const response = await POST(request, { params: { eventId: "evt-123" } });
    const json = (await response.json()) as { event: { id: string } };

    expect(response.status).toBe(202);
    expect(json.event.id).toBe("evt-123");
    expect(triggerProcessorReplay).toHaveBeenCalledWith("evt-123", { force: true }, expect.any(Headers));
  });

  it("returns error payloads when upstream fails", async () => {
    const POST = await importRoute();
    mockHeaders.mockReturnValue(new Headers());
    triggerProcessorReplay.mockResolvedValue({
      ok: false,
      status: 409,
      error: "Replay limit reached",
    });

    const request = createRequest("http://localhost/api/billing/replays/evt-123", { force: false });

    const response = await POST(request, { params: { eventId: "evt-123" } });
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(json.error).toBe("Replay limit reached");
  });

  it("defaults to non-forced replay when body parsing fails", async () => {
    const POST = await importRoute();
    mockHeaders.mockReturnValue(new Headers());
    triggerProcessorReplay.mockResolvedValue({
      ok: true,
      status: 202,
      event: {
        id: "evt-200",
        provider: "stripe",
        externalId: "evt_200",
        correlationId: null,
        workspaceId: null,
        invoiceId: null,
        replayRequested: true,
        replayRequestedAt: "2024-01-01T00:00:00.000Z",
        replayAttempts: 0,
        replayedAt: null,
        lastReplayError: null,
        receivedAt: "2024-01-01T00:00:00.000Z",
        createdAt: "2024-01-01T00:00:00.000Z",
        status: "queued",
      },
    });

    const request = createRequest("http://localhost/api/billing/replays/evt-200");

    const response = await POST(request, { params: { eventId: "evt-200" } });

    expect(triggerProcessorReplay).toHaveBeenCalledWith("evt-200", { force: false }, expect.any(Headers));
    expect(response.status).toBe(202);
  });
});
