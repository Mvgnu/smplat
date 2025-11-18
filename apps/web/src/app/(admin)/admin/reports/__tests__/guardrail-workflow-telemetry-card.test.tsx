import { jest } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";

import { GuardrailWorkflowTelemetryCard } from "../guardrail-workflow-telemetry-card.client";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

const mockUseWorkflowSummary = jest.fn();

jest.mock("@/lib/api/reporting", () => ({
  useGuardrailWorkflowTelemetrySummary: (...args: unknown[]) => mockUseWorkflowSummary(...args),
}));

const baseSummary: GuardrailWorkflowTelemetrySummary = {
  totalEvents: 0,
  lastCapturedAt: null,
  actionCounts: [],
  attachmentTotals: { upload: 0, remove: 0, copy: 0, tag: 0 },
  providerActivity: [],
};

describe("GuardrailWorkflowTelemetryCard", () => {
  beforeEach(() => {
    mockUseWorkflowSummary.mockReset();
  });

  it("renders placeholder when no telemetry exists", () => {
    mockUseWorkflowSummary.mockReturnValue({
      data: baseSummary,
      error: undefined,
      isValidating: false,
      isLoading: false,
      mutate: jest.fn(),
    });

    render(<GuardrailWorkflowTelemetryCard initialSummary={baseSummary} refreshIntervalMs={0} />);

    expect(screen.getByText(/workflow telemetry/i)).toBeInTheDocument();
    expect(screen.getByText(/Attachment uploads/i)).toBeInTheDocument();
  });

  it("shows action counts and provider highlights when summary data is provided", () => {
    const summary: GuardrailWorkflowTelemetrySummary = {
      totalEvents: 5,
      lastCapturedAt: "2025-01-03T00:00:00.000Z",
      actionCounts: [
        { action: "slack.copy", count: 3, lastOccurredAt: "2025-01-03T00:00:00.000Z" },
        { action: "attachment.upload", count: 2, lastOccurredAt: "2025-01-02T12:00:00.000Z" },
      ],
      attachmentTotals: { upload: 2, remove: 1, copy: 1, tag: 0 },
      providerActivity: [
        {
          providerId: "prov-1",
          providerName: "Alpha Supply",
          lastAction: "slack.copy",
          lastActionAt: "2025-01-03T00:00:00.000Z",
          totalActions: 3,
        },
      ],
    };

    mockUseWorkflowSummary.mockReturnValue({
      data: summary,
      error: undefined,
      isValidating: false,
      isLoading: false,
      mutate: jest.fn(),
    });

    render(<GuardrailWorkflowTelemetryCard initialSummary={summary} refreshIntervalMs={0} />);

    expect(screen.getByText(/Guardrail composer activity/i)).toBeInTheDocument();
    expect(screen.getAllByText(/slack.copy/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Alpha Supply/i)).toBeInTheDocument();
    const attachmentCard = screen.getByText(/Attachment activity/i).closest("div") as HTMLElement;
    expect(within(attachmentCard).getByText(/Uploads/i)).toBeInTheDocument();
    expect(within(attachmentCard).getByText("2")).toBeInTheDocument();
  });
});
