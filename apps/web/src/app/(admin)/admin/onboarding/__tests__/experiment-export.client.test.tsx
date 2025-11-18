import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { OnboardingExperimentExportControls } from "../experiment-export.client";
import type { OnboardingExperimentEvent } from "@/types/reporting";

const mockEvent = (overrides: Partial<OnboardingExperimentEvent> = {}): OnboardingExperimentEvent => ({
  eventId: overrides.eventId ?? "event-1",
  journeyId: overrides.journeyId ?? "journey-1",
  orderId: overrides.orderId ?? "order-1",
  orderNumber: overrides.orderNumber ?? "SMP-1001",
  slug: overrides.slug ?? "pricing-test",
  variantKey: overrides.variantKey ?? "variant-a",
  variantName: overrides.variantName ?? "Variant A",
  isControl: overrides.isControl ?? false,
  assignmentStrategy: overrides.assignmentStrategy ?? "manual",
  status: overrides.status ?? "assigned",
  featureFlagKey: overrides.featureFlagKey ?? "feature.flag",
  recordedAt: overrides.recordedAt ?? "2024-01-01T00:00:00.000Z"
});

describe("OnboardingExperimentExportControls", () => {
  const originalFetch = global.fetch;
  const originalCreateObjectUrl = global.URL.createObjectURL;
  const originalRevokeObjectUrl = global.URL.revokeObjectURL;

  beforeEach(() => {
    jest.resetAllMocks();
    global.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    global.URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    global.URL.createObjectURL = originalCreateObjectUrl;
    global.URL.revokeObjectURL = originalRevokeObjectUrl;
    jest.restoreAllMocks();
  });

  it("requests the selected limit when downloading the latest batch", async () => {
    const responsePayload = {
      events: [mockEvent()],
      nextCursor: "2024-01-02T00:00:00.000Z"
    };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responsePayload
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<OnboardingExperimentExportControls />);

    fireEvent.change(screen.getByLabelText(/Rows per batch/i), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /Download latest/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reporting/onboarding/experiment-events?limit=100",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("uses the saved cursor when requesting the next page", async () => {
    const firstPayload = {
      events: [mockEvent()],
      nextCursor: "2024-01-02T00:00:00.000Z"
    };
    const secondPayload = {
      events: [mockEvent({ eventId: "event-2", recordedAt: "2024-01-03T00:00:00.000Z" })],
      nextCursor: null
    };

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => firstPayload
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => secondPayload
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    render(<OnboardingExperimentExportControls />);

    fireEvent.click(screen.getByRole("button", { name: /Download latest/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const nextButton = screen.getByRole("button", { name: /Download next page/i });
    await waitFor(() => expect(nextButton).not.toBeDisabled());

    fireEvent.click(nextButton);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/reporting/onboarding/experiment-events?limit=250&cursor=2024-01-02T00%3A00%3A00.000Z",
      expect.objectContaining({ method: "GET" })
    );
  });
});
