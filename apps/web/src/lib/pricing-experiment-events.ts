export type PricingExperimentEventInput = {
  slug: string;
  variantKey: string;
  exposures?: number;
  conversions?: number;
  revenueCents?: number;
};

const EVENTS_ENDPOINT = "/api/catalog/pricing-experiments/events";

export async function logPricingExperimentEvents(events: PricingExperimentEventInput[]): Promise<void> {
  if (events.length === 0) {
    return;
  }

  const response = await fetch(EVENTS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ events }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || "Failed to log pricing experiment events");
  }
}
