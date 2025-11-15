import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";

import { ProductExperienceCard } from "../product-experience-card";
import { storefrontExperience } from "@/data/storefront-experience";
import type { CartProductExperience } from "@/types/cart";

describe("ProductExperienceCard", () => {
  it("renders trust + loyalty data when product experience provided", () => {
    const product = storefrontExperience.products[0];
    render(<ProductExperienceCard product={product} />);

    expect(screen.getByText(product.name)).toBeInTheDocument();
    expect(screen.getByText(product.trustSignal.value)).toBeInTheDocument();
    expect(screen.getByText(product.loyaltyHint.value)).toBeInTheDocument();
    expect(screen.getByTestId("product-loyalty-progress")).toHaveStyle(
      `width: ${Math.round(product.loyaltyHint.progress * 100)}%`
    );
  });

  it("supports compact variant with highlight limiter", () => {
    const product = storefrontExperience.products[0];
    render(<ProductExperienceCard product={product} variant="compact" />);

    const highlightContainer = screen.getByTestId("experience-highlights");
    expect(highlightContainer.querySelectorAll("span").length).toBeGreaterThan(0);
  });

  it("renders with stored cart experience data", () => {
    const base = storefrontExperience.products[0];
    const cartExperience: CartProductExperience = {
      slug: base.slug,
      name: base.name,
      category: base.category,
      journeyInsight: base.journeyInsight,
      trustSignal: base.trustSignal,
      loyaltyHint: base.loyaltyHint,
      highlights: base.highlights,
      sla: base.sla
    };

    render(<ProductExperienceCard product={cartExperience} />);
    expect(screen.getByText(cartExperience.name)).toBeInTheDocument();
  });

  it("renders nothing when no product data is provided", () => {
    const { container } = render(<ProductExperienceCard product={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
