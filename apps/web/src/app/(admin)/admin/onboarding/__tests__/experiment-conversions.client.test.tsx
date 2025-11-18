import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ExperimentConversionCardClient } from "../experiment-conversions.client";
import type { ExperimentConversionMetric } from "@/types/reporting";

const buildMetric = (overrides: Partial<ExperimentConversionMetric> = {}): ExperimentConversionMetric => ({
  slug: overrides.slug ?? "experiment-a",
  orderCount: overrides.orderCount ?? 5,
  journeyCount: overrides.journeyCount ?? 4,
  orderTotal: overrides.orderTotal ?? 1250,
  orderCurrency: overrides.orderCurrency ?? "USD",
  loyaltyPoints: overrides.loyaltyPoints ?? 4200,
  lastActivity: overrides.lastActivity ?? "2024-01-01T00:00:00.000Z",
});

describe("ExperimentConversionCardClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetAllMocks();
    window.history.replaceState(null, "", "/admin/onboarding");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("updates the conversion cursor in the URL when fetching the next page", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        metrics: [buildMetric({ slug: "experiment-b" })],
        nextCursor: "cursor-3",
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const historySpy = jest.spyOn(window.history, "replaceState");

    render(<ExperimentConversionCardClient initialEntries={[buildMetric()]} initialCursor="cursor-2" />);

    const button = screen.getByRole("button", { name: /load next conversions/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/reporting/onboarding/experiment-conversions?limit=8&cursor=cursor-2",
        expect.objectContaining({ cache: "no-store" }),
      ),
    );
    await waitFor(() => expect(historySpy).toHaveBeenLastCalledWith(null, "", expect.stringContaining("conversionCursor=cursor-2")));
    expect(await screen.findByText(/historical cursor/i)).toBeInTheDocument();
    expect(screen.getByText("cursor-2")).toBeInTheDocument();
  });

  it("resets conversions and clears the cursor from the URL", async () => {
    window.history.replaceState(null, "", "/admin/onboarding?conversionCursor=cursor-old");
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        metrics: [buildMetric({ slug: "experiment-reset" })],
        nextCursor: "cursor-new",
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const historySpy = jest.spyOn(window.history, "replaceState");

    render(
      <ExperimentConversionCardClient
        initialEntries={[buildMetric({ slug: "experiment-old" })]}
        initialCursor="cursor-next"
        initialRequestCursor="cursor-old"
      />,
    );

    expect(screen.getByText(/historical cursor/i)).toBeInTheDocument();

    const resetButton = screen.getByRole("button", { name: /reset conversions/i });
    fireEvent.click(resetButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/reporting/onboarding/experiment-conversions?limit=8",
        expect.objectContaining({ cache: "no-store" }),
      ),
    );
    await waitFor(() =>
      expect(historySpy).toHaveBeenLastCalledWith(null, "", expect.not.stringContaining("conversionCursor=")),
    );
  });

  it("renders historical badge when initial cursor is provided", () => {
    render(
      <ExperimentConversionCardClient
        initialEntries={[buildMetric({ slug: "cursor-test" })]}
        initialCursor="cursor-future"
        initialRequestCursor="cursor-history"
      />,
    );

    expect(screen.getByText(/historical cursor/i)).toBeInTheDocument();
    expect(screen.getByText("cursor-history")).toBeInTheDocument();
  });
});
