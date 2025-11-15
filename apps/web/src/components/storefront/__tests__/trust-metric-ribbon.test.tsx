import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";

import { TrustMetricRibbon } from "../trust-metric-ribbon";
import type { TrustMetric } from "@/data/storefront-experience";

const sampleMetrics: TrustMetric[] = [
  {
    id: "confidence",
    label: "Checkout confidence score",
    value: "98.2%",
    description: "Orders ran without exception holds last quarter.",
    trendLabel: "vs. last quarter",
    trendValue: "+2.1%",
    trendDirection: "up"
  }
];

describe("TrustMetricRibbon", () => {
  it("renders metrics with trend labels", () => {
    render(<TrustMetricRibbon metrics={sampleMetrics} />);

    expect(screen.getByText("Checkout confidence score")).toBeInTheDocument();
    expect(screen.getByText("98.2%")).toBeInTheDocument();
    expect(screen.getByText(/vs. last quarter/i)).toBeInTheDocument();
  });

  it("renders nothing when metrics are empty", () => {
    const { container } = render(<TrustMetricRibbon metrics={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

