import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockLoadOrderReceipt = jest.fn();
const mockRenderOrderReceiptPdf = jest.fn();

class TestResponse {
  private readonly headerMap = new Map<string, string>();
  private readonly body: unknown;
  status: number;
  headers = {
    get: (name: string) => this.headerMap.get(name.toLowerCase()) ?? null,
    set: (name: string, value: string) => {
      this.headerMap.set(name.toLowerCase(), value);
    },
  };

  constructor(body: unknown, init?: ResponseInit) {
    this.body = body;
    this.status = init?.status ?? 200;
    if (init?.headers && typeof init.headers === "object") {
      Object.entries(init.headers as Record<string, string>).forEach(([key, value]) => {
        this.headerMap.set(key.toLowerCase(), value);
      });
    }
  }

  async json(): Promise<unknown> {
    if (typeof this.body === "string") {
      try {
        return JSON.parse(this.body);
      } catch {
        return this.body;
      }
    }
    return this.body;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.body instanceof ArrayBuffer) {
      return this.body;
    }
    if (Buffer.isBuffer(this.body)) {
      return this.body;
    }
    if (typeof this.body === "string") {
      return Buffer.from(this.body);
    }
    if (this.body == null) {
      return Buffer.from([]);
    }
    return Buffer.from(JSON.stringify(this.body));
  }
}

if (typeof globalThis.Response === "undefined") {
  globalThis.Response = TestResponse as unknown as typeof Response;
}

jest.mock("@/lib/orders/receipt-service", () => ({
  loadOrderReceipt: (...args: Parameters<typeof mockLoadOrderReceipt>) => mockLoadOrderReceipt(...args)
}));

jest.mock("@/lib/orders/receipt-pdf", () => ({
  renderOrderReceiptPdf: (...args: Parameters<typeof mockRenderOrderReceiptPdf>) =>
    mockRenderOrderReceiptPdf(...args)
}));

describe("GET /api/orders/[orderId]/receipt", () => {
  beforeEach(() => {
    mockLoadOrderReceipt.mockReset();
    mockRenderOrderReceiptPdf.mockReset();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const importRoute = async () => {
    const routeModule = await import("../route");
    return routeModule.GET;
  };

  const createRequest = () => undefined as unknown as Request;

  it("streams the generated PDF with attachment headers", async () => {
    const GET = await importRoute();
    const fakeReceipt = {
      id: "order-123",
      orderNumber: "SM9001",
    } as unknown as import("@/lib/orders/receipt-exports").OrderReceiptPayload;
    mockLoadOrderReceipt.mockResolvedValue(fakeReceipt);
    const pdfBuffer = Buffer.from("%PDF-1.4 sample%");
    mockRenderOrderReceiptPdf.mockResolvedValue(pdfBuffer);

    const response = await GET(createRequest(), { params: { orderId: "order-123" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(
      "smplat-order-SM9001.pdf"
    );
    const bodyBuffer = Buffer.from(await response.arrayBuffer());
    expect(bodyBuffer.equals(pdfBuffer)).toBe(true);
    expect(mockLoadOrderReceipt).toHaveBeenCalledWith("order-123");
    expect(mockRenderOrderReceiptPdf).toHaveBeenCalledWith(fakeReceipt);
  });

  it("returns 404 when the order is missing", async () => {
    const GET = await importRoute();
    mockLoadOrderReceipt.mockResolvedValue(null);

    const response = await GET(createRequest(), { params: { orderId: "missing" } });
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(payload.error).toMatch(/not found/i);
    expect(mockRenderOrderReceiptPdf).not.toHaveBeenCalled();
  });

  it("returns 500 when PDF generation fails", async () => {
    const GET = await importRoute();
    const fakeReceipt = {
      id: "order-500",
      orderNumber: null,
    } as unknown as import("@/lib/orders/receipt-exports").OrderReceiptPayload;
    mockLoadOrderReceipt.mockResolvedValue(fakeReceipt);
    mockRenderOrderReceiptPdf.mockRejectedValue(new Error("boom"));

    const response = await GET(createRequest(), { params: { orderId: "order-500" } });
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(payload.error).toMatch(/unable to build/i);
  });
});
