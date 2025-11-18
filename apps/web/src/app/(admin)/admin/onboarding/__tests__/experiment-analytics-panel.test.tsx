import { render, screen } from "@testing-library/react";

import { ExperimentAnalyticsPanel } from "../experiment-analytics";

describe("ExperimentAnalyticsPanel", () => {
  it("renders auto guardrail action chips when provided via props", () => {
    render(
      <ExperimentAnalyticsPanel
        trendSeries={[]}
        variantBreakdown={[
          { slug: "alpha", variantKey: "v1", variantLabel: "Variant 1", active: 1, stalled: 0 }
        ]}
        conversionMetrics={[]}
        autoActions={[
          {
            providerId: "prov-1",
            providerName: "Alpha Supply",
            action: "pause",
            ranAt: "2025-01-01T00:00:00.000Z",
            automationHref: "/admin/fulfillment/providers/prov-1?tab=automation"
          }
        ]}
        autoActionsRunAt="2025-01-01T00:00:00.000Z"
      />
    );

    expect(screen.getByText(/Auto guardrail actions/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View follow-ups/i })).toHaveAttribute(
      "href",
      "/admin/fulfillment/providers/prov-1?tab=automation"
    );
  });

  it("renders a clear cursor form when a historical cursor is active", () => {
    const mockAction = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <ExperimentAnalyticsPanel
        trendSeries={[]}
        variantBreakdown={[]}
        conversionMetrics={[]}
        conversionRequestCursor="cursor-123"
        clearCursorAction={mockAction as unknown as (formData: FormData) => Promise<void>}
        clearCursorHref="/admin/onboarding#experiment-analytics"
      />
    );

    expect(screen.getByRole("button", { name: /Clear cursor/i })).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it("renders quick-order funnel metrics when telemetry is provided", () => {
    render(
      <ExperimentAnalyticsPanel
        trendSeries={[]}
        variantBreakdown={[]}
        conversionMetrics={[]}
        quickOrderFunnel={{
          startCount: 12,
          abortCount: 3,
          completeCount: 6,
          completionRate: 50,
          abortReasons: [
            { reason: "not_now", count: 2 },
            { reason: "session_expired", count: 1 }
          ],
          dailySeries: [
            { date: "2025-01-01", starts: 4, completes: 2 },
            { date: "2025-01-02", starts: 8, completes: 4 }
          ],
          lastEventAt: "2025-01-02T12:00:00.000Z"
        }}
      />
    );

    expect(screen.getByText(/Quick-order funnel/i)).toBeInTheDocument();
    expect(screen.getByText(/Local telemetry:\s+50%/i)).toBeInTheDocument();
    expect(screen.getByText(/not now/i)).toBeInTheDocument();
  });
});
