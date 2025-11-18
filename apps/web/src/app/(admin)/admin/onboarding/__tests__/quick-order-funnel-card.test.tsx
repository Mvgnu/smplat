import { render, screen } from "@testing-library/react";

jest.mock("@/components/account/QuickOrderWorkflowTelemetry.client", () => ({
  QuickOrderWorkflowTelemetry: ({ initialTelemetry }: { initialTelemetry: unknown }) => (
    <div data-testid="workflow-telemetry">{initialTelemetry ? "Telemetry ready" : "Telemetry pending"}</div>
  )
}));

import { QuickOrderFunnelCard } from "../quick-order-funnel-card.client";

describe("QuickOrderFunnelCard", () => {
  it("renders local/export metrics, deltas, and download controls", () => {
    render(
      <QuickOrderFunnelCard
        funnel={{
          startCount: 100,
          abortCount: 20,
          completeCount: 60,
          completionRate: 60,
          abortReasons: [
            { reason: "not_now", count: 10 },
            { reason: "session_expired", count: 5 }
          ],
          dailySeries: [
            { date: "2025-01-01", starts: 50, completes: 25 },
            { date: "2025-01-02", starts: 50, completes: 35 }
          ],
          lastEventAt: "2025-01-02T15:00:00.000Z"
        }}
        exportStatus={{
          syncedAt: "2025-01-02T15:30:00.000Z",
          events: 500,
          downloadUrl: "https://example.com/export.ndjson",
          workflowUrl: "https://github.com/smplat/smplat/actions/workflows/quick-order-telemetry-export.yml",
          metrics: {
            startCount: 120,
            abortCount: 24,
            completeCount: 70,
            completionRate: 58
          }
        }}
        workflowTelemetry={{
          totalEvents: 12,
          lastCapturedAt: "2025-01-02T15:15:00.000Z",
          actionCounts: [],
          attachmentTotals: { upload: 0, remove: 0, copy: 0, tag: 0 },
          providerActivity: []
        }}
      />
    );

    expect(screen.getByRole("button", { name: /Local telemetry/i })).toBeInTheDocument();
    expect(screen.getByText(/Snowflake export:\s+120/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Δ/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Download local NDJSON/i })).toBeInTheDocument();
    const exportDownload = screen.getByRole("link", { name: /Download export NDJSON/i });
    expect(exportDownload).toHaveAttribute("href", "/api/reporting/quick-order-export");
    expect(screen.getByTestId("workflow-telemetry")).toHaveTextContent(/Telemetry ready/i);
  });
});
