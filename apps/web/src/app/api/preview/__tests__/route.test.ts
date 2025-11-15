import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockEnable = jest.fn();
const mockDisable = jest.fn();
const mockCookiesSet = jest.fn();

jest.mock("next/headers", () => ({
  draftMode: () => ({
    isEnabled: false,
    enable: mockEnable,
    disable: mockDisable
  }),
  cookies: () => ({
    set: mockCookiesSet
  })
}));

const mockInfo = jest.fn();
const mockWarn = jest.fn();

jest.mock("@/server/observability/logger", () => ({
  cmsLogger: {
    info: (...args: unknown[]) => mockInfo(...args),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: jest.fn()
  }
}));

const previewMetrics: string[] = [];

jest.mock("@/server/observability/cms-telemetry", () => ({
  recordPreviewMetric: (key: string) => {
    previewMetrics.push(key);
  }
}));

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
}

if (typeof globalThis.Response === "undefined") {
  globalThis.Response = TestResponse as unknown as typeof Response;
}

const createRequest = (url: string) => {
  return { url } as Request;
};

describe("preview GET", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    previewMetrics.splice(0, previewMetrics.length);
    mockEnable.mockClear();
    mockDisable.mockClear();
    mockCookiesSet.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    process.env = {
      ...originalEnv,
      CMS_PROVIDER: "payload",
      PAYLOAD_PREVIEW_SECRET: "payload-secret",
      SANITY_PREVIEW_SECRET: "legacy-secret"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  const importRoute = async () => {
    const routeModule = await import("../route");
    return {
      GET: routeModule.GET,
      DELETE: routeModule.DELETE
    };
  };

  it("rejects missing secrets", async () => {
    const { GET } = await importRoute();
    const request = createRequest("http://localhost/api/preview?redirect=/blog");

    const response = await GET(request);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(json.error).toBe("Missing preview secret");
    expect(previewMetrics).toContain("missing_secret");
    expect(mockWarn).toHaveBeenCalledWith("preview denied: missing secret", { provider: "payload" });
  });

  it("rejects invalid secrets", async () => {
    const { GET } = await importRoute();
    const request = createRequest(
      "http://localhost/api/preview?secret=invalid&redirect=/pricing&provider=payload"
    );

    const response = await GET(request);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(json.error).toBe("Invalid preview secret");
    expect(previewMetrics).toContain("invalid_secret");
  });

  it("rejects external redirects", async () => {
    const { GET } = await importRoute();
    const request = createRequest(
      "http://localhost/api/preview?secret=legacy-secret&redirect=https://malicious.example"
    );

    const response = await GET(request);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid redirect");
    expect(previewMetrics).toContain("invalid_redirect");
  });

  it("enables preview and redirects with sanitized path", async () => {
    const { GET } = await importRoute();
    const request = createRequest(
      "http://localhost/api/preview?secret=payload-secret&redirect=blog/article-one"
    );

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/blog/article-one?previewProvider=payload");
    expect(mockEnable).toHaveBeenCalled();
    expect(mockCookiesSet).toHaveBeenCalledWith("smplat-preview-provider", "payload", expect.any(Object));
    expect(previewMetrics).toContain("success");
    expect(mockInfo).toHaveBeenCalledWith("preview enabled", {
      provider: "payload",
      redirect: "/blog/article-one"
    });
  });

  it("disables preview on DELETE", async () => {
    const { DELETE } = await importRoute();
    const response = await DELETE();
    const json = (await response.json()) as { preview: boolean };

    expect(response.status).toBe(200);
    expect(json.preview).toBe(false);
    expect(mockDisable).toHaveBeenCalled();
    expect(previewMetrics).toContain("success");
  });
});
