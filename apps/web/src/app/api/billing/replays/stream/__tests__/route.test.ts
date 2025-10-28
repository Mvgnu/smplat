import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { ReadableStream } from "stream/web";

const originalEnv = { ...process.env };

const mockFetch = jest.fn();

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

describe("GET /api/billing/replays/stream", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    (globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;
    (globalThis as typeof globalThis & { TextEncoder: typeof TextEncoder }).TextEncoder = TextEncoder;
    (globalThis as typeof globalThis & { TextDecoder: typeof TextDecoder }).TextDecoder = TextDecoder;
    (globalThis as typeof globalThis & { ReadableStream: typeof ReadableStream }).ReadableStream = ReadableStream;
    mockFetch.mockReset();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns 503 when the console is disabled", async () => {
    process.env.CHECKOUT_API_KEY = "";
    const route = await import("../route");
    const response = await route.GET(createRequest("http://localhost/api/billing/replays/stream"));
    expect(response.status).toBe(503);
  });

  it("proxies the upstream stream when credentials exist", async () => {
    process.env.CHECKOUT_API_KEY = "test-key";
    process.env.API_BASE_URL = "http://upstream.local";

    const encoder = new TextEncoder();
    const chunk = encoder.encode("event: heartbeat\n\n");

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    });

    const route = await import("../route");
    const response = await route.GET(
      createRequest("http://localhost/api/billing/replays/stream?provider=stripe"),
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [targetUrl, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(String(targetUrl)).toBe(
      "http://upstream.local/api/v1/billing/replays/stream?provider=stripe",
    );
    expect(init).toEqual(
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({ Accept: "text/event-stream", "X-API-Key": "test-key" }),
      }),
    );

    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = reader ? await reader.read() : { done: true, value: undefined };
    expect(first.done).toBe(false);
    const decoder = new TextDecoder();
    expect(decoder.decode(first.value)).toContain("heartbeat");
    const second = reader ? await reader.read() : { done: true };
    expect(second.done).toBe(true);
  });
});

function createRequest(url: string): Request {
  return {
    method: "GET",
    url,
    headers: new Headers(),
  } as unknown as Request;
}
