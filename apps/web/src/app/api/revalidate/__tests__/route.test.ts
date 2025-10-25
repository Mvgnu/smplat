import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockRevalidatePath = jest.fn();

jest.mock("next/cache", () => ({
  revalidatePath: (...args: Parameters<typeof mockRevalidatePath>) => mockRevalidatePath(...args)
}));

const mockRecordMetric = jest.fn();
const mockInfo = jest.fn();
const mockWarn = jest.fn();
const mockError = jest.fn();

jest.mock("@/server/observability/cms-telemetry", () => ({
  recordRevalidateMetric: (...args: unknown[]) => mockRecordMetric(...args)
}));

jest.mock("@/server/observability/logger", () => ({
  cmsLogger: {
    info: (...args: unknown[]) => mockInfo(...args),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: (...args: unknown[]) => mockError(...args)
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

  static redirect(input: string | URL, status = 302) {
    const response = new TestResponse(null, { status });
    response.headers.set("location", input.toString());
    return response;
  }
}

if (typeof globalThis.Response === "undefined") {
  (globalThis as typeof globalThis & { Response: typeof TestResponse }).Response = TestResponse as unknown as typeof Response;
}

const createRequest = (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
  const headerMap = new Map<string, string>();
  Object.entries(init.headers ?? {}).forEach(([key, value]) => {
    headerMap.set(key.toLowerCase(), value);
  });
  const body = init.body;
  return {
    method: init.method ?? "GET",
    url,
    headers: {
      get: (name: string) => headerMap.get(name.toLowerCase()) ?? null
    },
    json: async () => {
      if (typeof body === "string") {
        return JSON.parse(body);
      }
      if (body === undefined) {
        return {};
      }
      return body;
    }
  } as unknown as Request;
};

describe("revalidate POST", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    mockRevalidatePath.mockClear();
    mockRecordMetric.mockClear();
    mockInfo.mockClear();
    mockWarn.mockClear();
    mockError.mockClear();
    process.env = {
      ...originalEnv,
      CMS_PROVIDER: "payload",
      CMS_ENV: "test",
      PAYLOAD_REVALIDATE_SECRET: "payload-secret",
      SANITY_REVALIDATE_SECRET: "sanity-secret",
      PAYLOAD_URL: "https://cms.example.com"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  const importRoute = async () => {
    const routeModule = await import("../route");
    return {
      POST: routeModule.POST,
      revalidatePath: mockRevalidatePath
    };
  };

  it("revalidates payload marketing pages when signature matches", async () => {
    const { POST, revalidatePath } = await importRoute();

    const request = createRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payload-signature": "payload-secret"
      },
      body: {
        collection: "pages",
        doc: { slug: "pricing", environment: "test" }
      }
    });

    const response = await POST(request);
    const json = (await response.json()) as { paths: string[] };

    expect(response.status).toBe(200);
    expect(json.paths).toEqual(["/pricing"]);
    expect(json.mode).toBe("update");
    expect(revalidatePath).toHaveBeenCalledWith("/pricing");
    expect(mockRecordMetric).toHaveBeenCalledWith("success");
  });

  it("skips payload revalidation for other environments", async () => {
    const { POST, revalidatePath } = await importRoute();

    const request = createRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payload-signature": "payload-secret"
      },
      body: {
        collection: "pages",
        doc: { slug: "pricing", environment: "staging" }
      }
    });

    const response = await POST(request);
    const json = (await response.json()) as { revalidated: boolean; reason?: string };

    expect(response.status).toBe(202);
    expect(json.revalidated).toBe(false);
    expect(json.reason).toBe("Environment mismatch");
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(mockRecordMetric).toHaveBeenCalledWith("skipped");
  });

  it("revalidates Sanity payloads using legacy signature", async () => {
    const { POST, revalidatePath } = await importRoute();

    const request = createRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sanity-signature": "sanity-secret"
      },
      body: {
        slug: { current: "automation-workflows" }
      }
    });

    const response = await POST(request);
    const json = (await response.json()) as { paths: string[] };

    expect(response.status).toBe(200);
    expect(json.paths).toEqual(["/automation-workflows"]);
    expect(revalidatePath).toHaveBeenCalledWith("/automation-workflows");
    expect(mockRecordMetric).toHaveBeenCalledWith("success");
  });

  it("returns unauthorized when signatures do not match", async () => {
    const { POST } = await importRoute();

    const request = createRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payload-signature": "invalid"
      },
      body: { collection: "pages", doc: { slug: "pricing" } }
    });

    const response = await POST(request);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(json.error).toBe("Invalid signature");
    expect(mockRecordMetric).toHaveBeenCalledWith("error");
  });

  it("respects provider header overrides", async () => {
    const { POST, revalidatePath } = await importRoute();

    const request = createRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cms-provider": "payload",
        "x-payload-signature": "payload-secret"
      },
      body: {
        collection: "pages",
        paths: ["/about", "about"],
        doc: { slug: "about", environment: "test" }
      }
    });

    const response = await POST(request);
    const json = (await response.json()) as { paths: string[] };

    expect(response.status).toBe(200);
    expect(json.paths).toEqual(["/about"]);
    expect(revalidatePath).toHaveBeenCalledWith("/about");
  });

  it("handles delete payloads using previousDoc", async () => {
    const { POST, revalidatePath } = await importRoute();

    const request = createRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payload-signature": "payload-secret"
      },
      body: {
        collection: "blog-posts",
        previousDoc: { slug: "obsolete-post", environment: "test" }
      }
    });

    const response = await POST(request);
    const json = (await response.json()) as { paths: string[]; mode: string };

    expect(response.status).toBe(200);
    expect(json.paths).toEqual(["/blog", "/blog/obsolete-post"]);
    expect(json.mode).toBe("delete");
    expect(revalidatePath).toHaveBeenCalledWith("/blog");
    expect(revalidatePath).toHaveBeenCalledWith("/blog/obsolete-post");
  });

  it("skips invalid paths and returns 202", async () => {
    const { POST, revalidatePath } = await importRoute();

    const request = createRequest("http://localhost/api/revalidate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-payload-signature": "payload-secret"
      },
      body: {
        collection: "pages",
        paths: ["../../escape"],
        doc: { slug: "escape", environment: "test" }
      }
    });

    const response = await POST(request);
    const json = (await response.json()) as { revalidated: boolean; reason?: string };

    expect(response.status).toBe(202);
    expect(json.revalidated).toBe(false);
    expect(json.reason).toBe("No valid paths");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
