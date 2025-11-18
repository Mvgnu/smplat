import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GuardrailAlertActions } from "../GuardrailAlertActions";
import type { GuardrailAlert } from "@/types/reporting";

jest.mock("@/lib/telemetry/events", () => ({
  trackGuardrailAlert: jest.fn(),
  trackGuardrailAutomation: jest.fn(),
}));

const { trackGuardrailAutomation } = jest.requireMock("@/lib/telemetry/events");

describe("GuardrailAlertActions", () => {
  beforeEach(() => {
    trackGuardrailAutomation.mockReset();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  const buildAlert = (): GuardrailAlert => ({
    id: "alert-1",
    providerId: "provider-1",
    providerName: "Provider One",
    severity: "critical",
    reasons: ["Replay failures"],
    guardrailFailures: 3,
    guardrailWarnings: 1,
    replayFailures: 5,
    replayTotal: 8,
    linkHref: "/admin/fulfillment/providers/provider-1?tab=automation",
    automationHref: "/admin/fulfillment/providers/provider-1?tab=automation",
    detectedAt: new Date().toISOString(),
    platformContexts: [
      {
        id: "instagram::@brand",
        label: "Instagram @brand",
        handle: "@brand",
        platformType: "instagram",
      },
    ],
  });

  it("sends providerId metadata when logging a quick follow-up", async () => {
    const alert = buildAlert();
    render(
      <GuardrailAlertActions
        alert={alert}
        conversionCursor="spring-offer"
        conversionHref="https://app.smplat.local/admin/reports#experiment-analytics"
      />,
    );

    const pauseButton = await screen.findByRole("button", { name: /pause variant/i });
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(trackGuardrailAutomation).toHaveBeenCalled();
    });

    const call = trackGuardrailAutomation.mock.calls.pop()?.[0];
    expect(call).toBeTruthy();
    expect(call.providerId).toBe(alert.providerId);
  });
});
