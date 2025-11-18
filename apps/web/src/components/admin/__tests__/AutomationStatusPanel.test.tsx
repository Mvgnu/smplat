import { render, screen } from "@testing-library/react";

jest.mock("../AutomationWorkflowTelemetry.client", () => ({
  AutomationWorkflowTelemetry: ({ initialTelemetry }: { initialTelemetry: unknown }) => (
    <div data-testid="automation-workflow-telemetry">
      {initialTelemetry ? "Telemetry ready" : "Workflow telemetry pending"}
    </div>
  )
}));

import { AutomationStatusPanel } from "../AutomationStatusPanel";
import type { ProviderAutomationHistory, ProviderAutomationStatus } from "@/types/provider-automation";

const baseHistory: ProviderAutomationHistory = {
  replay: [],
  alerts: [],
};

describe("AutomationStatusPanel", () => {
  it("renders backlog summary when only history data exists", () => {
    const history: ProviderAutomationHistory = {
      ...baseHistory,
      replay: [
        {
          ranAt: "2025-01-10T00:00:00.000Z",
          summary: {
            scheduledBacklog: 7,
            nextScheduledAt: "2025-01-10T01:30:00.000Z",
          },
        },
      ],
    };

    render(<AutomationStatusPanel status={null} history={history} />);

    expect(screen.getByText(/Replay backlog/i)).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText(/Next scheduled run/i)).toBeInTheDocument();
  });

  it("shows alert digest entries from status payload", () => {
    const status: ProviderAutomationStatus = {
      replay: null,
      alerts: {
        ranAt: "2025-01-10T02:00:00.000Z",
        summary: {
          alertsSent: 2,
          alertsDigest: [
            {
              providerId: "prov-alpha",
              providerName: "Alpha Network",
              reasons: ["guardrail fail", "replay errors"],
            },
          ],
        },
      },
    };

    render(<AutomationStatusPanel status={status} history={baseHistory} />);

    expect(screen.getByText(/Active alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/Alpha Network/i)).toBeInTheDocument();
    expect(screen.getByText(/guardrail fail/i)).toBeInTheDocument();
  });

  it("renders cohort load alerts digest when available", () => {
    const status: ProviderAutomationStatus = {
      replay: null,
      alerts: {
        ranAt: "2025-01-10T03:00:00.000Z",
        summary: {
          loadAlerts: 1,
          loadAlertsDigest: [
            {
              providerId: "prov-beta",
              providerName: "Beta Ops",
              presetId: "preset-1",
              presetLabel: "Growth Sprint",
              shortShare: 0.8,
              links: {
                merchandising: "/admin/merchandising?presetId=preset-1",
              },
            },
          ],
        },
      },
    };

    render(<AutomationStatusPanel status={status} history={baseHistory} />);

    expect(screen.getByText(/Cohort load alerts/i)).toBeInTheDocument();
    expect(screen.getByText(/Beta Ops/i)).toBeInTheDocument();
    expect(screen.getByText(/Growth Sprint/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View preset/i })).toBeInTheDocument();
  });

  it("renders auto guardrail actions when summary includes providers", () => {
    const status: ProviderAutomationStatus = {
      replay: null,
      alerts: {
        ranAt: "2025-01-10T04:00:00.000Z",
        summary: {
          alertsSent: 1,
          autoPausedProviders: [
            {
              providerId: "prov-1",
              providerName: "Alpha Supply",
              action: "pause",
              reasons: ["guardrail fail"],
            },
          ],
        },
      },
    };

    render(<AutomationStatusPanel status={status} history={baseHistory} />);

    expect(screen.getByText(/Auto guardrail actions/i)).toBeInTheDocument();
    expect(screen.getByText(/Alpha Supply/i)).toBeInTheDocument();
    const chip = screen.getByTitle(/Run:/i);
    expect(chip).toHaveAttribute("title", expect.stringContaining("guardrail fail"));
    const followUpLink = screen.getByRole("link", { name: /Open follow-ups/i });
    expect(followUpLink).toHaveAttribute("href", "/admin/fulfillment/providers/prov-1?tab=automation");
  });

  it("shows workflow telemetry insight for alert worker", () => {
    const status: ProviderAutomationStatus = {
      replay: null,
      alerts: {
        ranAt: "2025-01-10T05:00:00.000Z",
        summary: {
          alertsSent: 1,
        },
        metadata: {
          workflowTelemetry: {
            totalEvents: 3,
            lastCapturedAt: "2025-01-10T05:30:00.000Z",
            actionCounts: [{ action: "attachment.upload", count: 2, lastOccurredAt: "2025-01-10T05:30:00.000Z" }],
            attachmentTotals: { upload: 2, remove: 0, copy: 1, tag: 0 },
            providerActivity: [],
          },
        },
      },
    };

    render(<AutomationStatusPanel status={status} history={baseHistory} />);

    const telemetryBanner = screen.getByTestId("automation-workflow-telemetry");
    expect(telemetryBanner).toHaveTextContent(/Telemetry ready/i);
  });
});
