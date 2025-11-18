import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { GuardrailFollowUpQueueClient } from "../GuardrailFollowUpQueue.client";
import type { GuardrailQueueEntry } from "@/types/guardrail-queue";
import { trackGuardrailWorkflow } from "@/lib/telemetry/events";
import { uploadGuardrailAttachment } from "@/lib/guardrail-attachments";

jest.mock("@/components/account/QuickOrderWorkflowTelemetry.client", () => ({
  QuickOrderWorkflowTelemetry: ({ initialTelemetry }: { initialTelemetry: unknown }) => (
    <div data-testid="workflow-telemetry-mock">
      {initialTelemetry ? "Telemetry ready" : "Workflow telemetry pending"}
    </div>
  ),
}));

const replaceMock = jest.fn();
const refreshMock = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
    refresh: refreshMock,
  }),
  usePathname: () => "/admin/reports",
  useSearchParams: () => {
    const params = new URLSearchParams(window.location.search);
    return {
      get: (key: string) => params.get(key),
    };
  },
}));

jest.mock("@/lib/telemetry/events", () => ({
  trackGuardrailAutomation: jest.fn(),
  trackGuardrailWorkflow: jest.fn(),
}));

jest.mock("@/lib/guardrail-attachments", () => ({
  uploadGuardrailAttachment: jest.fn(),
}));

const mockEntries: GuardrailQueueEntry[] = [
  {
    providerId: "alpha",
    providerName: "Alpha Provider",
    providerHref: "/alpha",
    action: "pause",
    severity: "critical",
    isPaused: true,
    notes: "Need review",
    createdAt: "2025-01-01T00:00:00.000Z",
    platformContext: {
      id: "instagram",
      label: "Instagram DM",
      handle: "@alpha_ops",
      platformType: "instagram"
    },
    attachments: [
      {
        id: "att-alpha",
        fileName: "alpha-evidence.pdf",
        assetUrl: "https://example.com/alpha-evidence.pdf",
        storageKey: "s3://alpha",
        size: 2048,
        contentType: "application/pdf",
        uploadedAt: "2025-01-01T00:00:00.000Z",
      },
    ],
    conversionCursor: null,
    conversionHref: null,
  },
  {
    providerId: "beta",
    providerName: "Beta Provider",
    providerHref: "/beta",
    action: "resume",
    severity: "warning",
    isPaused: false,
    notes: null,
    createdAt: "2025-01-02T00:00:00.000Z",
    platformContext: null,
    attachments: null,
    conversionCursor: null,
    conversionHref: null,
  },
];

const originalFetch = global.fetch;

function createDeferred<T>() {
  let resolve: (value: T) => void;
  let reject: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {
    promise,
    resolve: resolve!,
    reject: reject!,
  };
}

describe("GuardrailFollowUpQueueClient filters", () => {
  beforeEach(() => {
    replaceMock.mockClear();
    refreshMock.mockClear();
    localStorage.clear();
    window.history.replaceState({}, "", "/admin/reports");
    global.fetch = originalFetch;
    (trackGuardrailWorkflow as jest.Mock).mockReset();
    (uploadGuardrailAttachment as jest.Mock).mockReset();
  });

  it("filters by provider name and syncs query params", async () => {
    render(<GuardrailFollowUpQueueClient entries={mockEntries} />);

    const input = screen.getByPlaceholderText(/Filter by provider/i);
    fireEvent.change(input, { target: { value: "beta" } });

    expect(await screen.findByText("Beta Provider")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Provider")).not.toBeInTheDocument();

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/admin/reports?guardrailProvider=beta", { scroll: false }),
    );
  });

  it("toggles severity filters and updates query params", async () => {
    render(<GuardrailFollowUpQueueClient entries={mockEntries} />);

    const warningToggle = screen.getByRole("button", { name: /Warning/ });
    fireEvent.click(warningToggle);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/admin/reports?guardrailSeverity=critical", { scroll: false }),
    );
    expect(screen.getByText("Alpha Provider")).toBeInTheDocument();
    expect(screen.queryByText("Beta Provider")).not.toBeInTheDocument();
  });

  it("filters by platform context from card toggle", async () => {
    render(<GuardrailFollowUpQueueClient entries={mockEntries} />);

    const platformButton = screen.getByRole("button", { name: /Platform:/i });
    fireEvent.click(platformButton);

    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith("/admin/reports?guardrailPlatform=instagram", { scroll: false }),
    );
    expect(screen.getByText("Alpha Provider")).toBeInTheDocument();
    expect(screen.queryByText("Beta Provider")).not.toBeInTheDocument();
  });

  it("keeps queued updates visible until submission completes", async () => {
    const deferred = createDeferred<Response>();
    global.fetch = jest.fn().mockReturnValue(deferred.promise) as unknown as typeof global.fetch;

    render(<GuardrailFollowUpQueueClient entries={mockEntries} />);

    const noteInput = screen.getAllByPlaceholderText(/Add workflow note/i)[0];
    fireEvent.change(noteInput, { target: { value: "Escalate: double-check" } });
    const submitButton = screen.getAllByRole("button", { name: /Log follow-up/i })[0];
    fireEvent.click(submitButton);

    expect(screen.getByText("Escalate: double-check")).toBeInTheDocument();

    deferred.resolve({
      ok: true,
      json: async () => ({ entry: { id: "queued" } }),
    } as Response);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("emits telemetry when copying existing attachments", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
    render(<GuardrailFollowUpQueueClient entries={mockEntries} />);

    const queueCards = screen.getAllByRole("article");
    const firstCard = queueCards[0];
    const copyButton = within(firstCard).getByRole("button", { name: "Copy" });
    fireEvent.click(copyButton);

    await waitFor(() =>
      expect(trackGuardrailWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowAction: "attachment.copy",
          providerId: "alpha",
        }),
      ),
    );
  });

  it("tracks attachment upload and removal telemetry", async () => {
    (uploadGuardrailAttachment as jest.Mock).mockResolvedValue({
      id: "pending-1",
      fileName: "pending.png",
      assetUrl: "https://example.com/pending.png",
      storageKey: "s3://pending",
      size: 5120,
      contentType: "image/png",
      uploadedAt: "2025-01-03T00:00:00.000Z",
    });
    render(<GuardrailFollowUpQueueClient entries={mockEntries} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["pending"], "pending.png", { type: "image/png" });
    await act(async () => {
      Object.defineProperty(fileInput, "files", {
        value: [file],
        configurable: true,
      });
      fireEvent.change(fileInput);
    });

    await waitFor(() =>
      expect(trackGuardrailWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowAction: "attachment.upload",
          providerId: "alpha",
        }),
      ),
    );

    const workflowSections = screen.getAllByText(/Workflow actions/i);
    const workflowPanel = workflowSections[0].closest("div") as HTMLElement;
    const removeButton = within(workflowPanel).getByRole("button", { name: "Remove" });
    fireEvent.click(removeButton);

    await waitFor(() =>
      expect(trackGuardrailWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowAction: "attachment.remove",
          providerId: "alpha",
        }),
      ),
    );
  });
});
