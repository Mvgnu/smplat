import { render, screen } from "@testing-library/react";

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
});
