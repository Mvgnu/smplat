import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

import { ProviderAutomationHistoryPanel } from "../ProviderAutomationHistoryPanel.client";
import type { ProviderAutomationHistory } from "@/types/provider-automation";
import type { GuardrailWorkflowTelemetrySummary } from "@/types/reporting";

const telemetryFixture: GuardrailWorkflowTelemetrySummary = {
  totalEvents: 8,
  lastCapturedAt: "2025-01-10T00:00:00.000Z",
  actionCounts: [{ action: "attachment.upload", count: 5, lastOccurredAt: "2025-01-10T00:00:00.000Z" }],
  attachmentTotals: { upload: 5, remove: 2, copy: 0, tag: 1 },
  providerActivity: [],
};

const baseHistory: ProviderAutomationHistory = {
  alerts: [],
  replay: [],
};

const createTelemetryHook =
  (summary: GuardrailWorkflowTelemetrySummary | null = telemetryFixture) =>
  () => ({
    data: summary,
    error: undefined,
    mutate: jest.fn(),
    isLoading: false,
    isValidating: false,
  });

describe("ProviderAutomationHistoryPanel", () => {
  it("renders auto guardrail action chips when history metadata includes automation logs", () => {
    const history: ProviderAutomationHistory = {
      ...baseHistory,
      alerts: [
        {
          ranAt: "2025-01-10T00:00:00.000Z",
          summary: { alertsSent: 1, autoPaused: 1, autoResumed: 0 },
          metadata: {
            autoPausedProviders: [
              {
                providerId: "prov-1",
                providerName: "Alpha Supply",
                action: "pause",
                reasons: ["3 guardrail fails"],
              },
            ],
            workflowTelemetry: {
              totalEvents: 4,
              lastCapturedAt: "2025-01-10T00:10:00.000Z",
              actionCounts: [{ action: "attachment.upload", count: 2, lastOccurredAt: "2025-01-10T00:10:00.000Z" }],
              attachmentTotals: { upload: 2, remove: 1, copy: 0, tag: 1 },
              providerActivity: [],
            },
          },
        },
      ],
    };

    render(<ProviderAutomationHistoryPanel history={history} telemetryHook={createTelemetryHook()} />);

    expect(screen.getByText(/Live workflow telemetry/i)).toBeInTheDocument();
    expect(screen.getByText(/8 actions/i)).toBeInTheDocument();
    expect(screen.getByText(/Auto guardrail actions/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Alpha Supply/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Auto pause/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Run:/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open follow-ups/i })).toHaveAttribute(
      "href",
      "/admin/fulfillment/providers/prov-1?tab=automation",
    );
    expect(screen.getAllByText(/Workflow telemetry/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/4 actions/i)).toBeInTheDocument();
    expect(screen.getByText(/Uploads 2/i)).toBeInTheDocument();
  });
});
