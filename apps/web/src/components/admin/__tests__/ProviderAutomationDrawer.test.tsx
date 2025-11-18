import { fireEvent, render, screen } from "@testing-library/react";

import type { ProviderAutomationDrawerEntry } from "../ProviderAutomationDrawer";
import { ProviderAutomationDrawer } from "../ProviderAutomationDrawer";

jest.mock("@/components/account/QuickOrderWorkflowTelemetry.client", () => ({
  QuickOrderWorkflowTelemetry: ({ initialTelemetry }: { initialTelemetry: unknown }) => (
    <div data-testid="workflow-telemetry-mock">{initialTelemetry ? "Telemetry ready" : "Workflow telemetry pending"}</div>
  ),
}));

function buildEntry(overrides: Partial<ProviderAutomationDrawerEntry> = {}): ProviderAutomationDrawerEntry {
  return {
    providerId: "provider-a",
    providerName: "Provider A",
    orderItems: [{ orderItemId: "item-1", orderItemLabel: "Growth preset" }],
    guardrailStatus: {
      providerId: overrides.providerId ?? "provider-a",
      providerName: overrides.providerName ?? "Provider A",
      isPaused: false,
      lastAction: "resume",
      updatedAt: "2024-02-01T10:00:00.000Z",
      lastFollowUpId: "follow-up-1",
    },
    followUps: {
      entries: [
        {
          id: "entry-1",
          providerId: overrides.providerId ?? "provider-a",
          providerName: overrides.providerName ?? "Provider A",
          action: "resume",
          notes: "Recovered automation",
          platformContext: null,
          createdAt: "2024-02-01T09:00:00.000Z",
        },
      ],
      nextCursor: null,
      status: null,
      providerTelemetry: null,
    },
    ...overrides,
  };
}

describe("ProviderAutomationDrawer", () => {
  it("renders fallback when no providers are linked", () => {
    render(<ProviderAutomationDrawer providers={[]} />);
    expect(
      screen.getByText("This journey has not been linked to provider automation yet."),
    ).toBeInTheDocument();
  });

  it("displays provider link, order items, and follow-up timeline for a single provider", () => {
    render(<ProviderAutomationDrawer providers={[buildEntry()]} />);

    expect(screen.getByText(/Linked provider/)).toHaveTextContent("Provider A");
    expect(screen.getByText(/Order items:/)).toHaveTextContent("Growth preset");
    expect(screen.getByText("Resumed automation")).toBeInTheDocument();
  });

  it("allows switching between providers and updates the timeline", () => {
    const providers: ProviderAutomationDrawerEntry[] = [
      buildEntry(),
      buildEntry({
        providerId: "provider-b",
        providerName: "Provider B",
        orderItems: [{ orderItemId: "item-2", orderItemLabel: "Automation pack" }],
        followUps: {
          entries: [
            {
              id: "entry-2",
              providerId: "provider-b",
              providerName: "Provider B",
              action: "pause",
              notes: "Paused due to risk review",
              platformContext: null,
              createdAt: "2024-02-02T11:00:00.000Z",
            },
          ],
          nextCursor: null,
          status: null,
          providerTelemetry: null,
        },
      }),
    ];

    render(<ProviderAutomationDrawer providers={providers} />);

    fireEvent.click(screen.getByRole("button", { name: "Provider B" }));

    expect(screen.getByText(/Linked provider/)).toHaveTextContent("Provider B");
    expect(screen.getByText("Paused variant")).toBeInTheDocument();
  });

  it("renders provider telemetry summary when available", () => {
    const telemetryEntry = buildEntry({
      followUps: {
        entries: [
          {
            id: "entry-telemetry",
            providerId: "provider-a",
            providerName: "Provider A",
            action: "pause",
            notes: null,
            platformContext: null,
            createdAt: "2024-02-03T10:00:00.000Z",
          },
        ],
        nextCursor: null,
        status: null,
        providerTelemetry: {
          totalOrders: 3,
          replays: { total: 2, executed: 1, failed: 1, scheduled: 0 },
          guardrails: { evaluated: 2, pass: 1, warn: 1, fail: 0 },
          guardrailHitsByService: {
            "svc-growth": { evaluated: 2, pass: 1, warn: 1, fail: 0 },
          },
          ruleOverridesByService: {},
        },
      },
    });

    render(<ProviderAutomationDrawer providers={[telemetryEntry]} />);

    expect(screen.getByText(/Provider automation telemetry/)).toBeInTheDocument();
    const routedRow = screen.getByText(/Routed orders/).closest("li");
    expect(routedRow).not.toBeNull();
    expect(routedRow).toHaveTextContent("3");
  });
});
