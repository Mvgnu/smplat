import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";

import { ProductShowcase } from "../product-showcase";
import { storefrontExperience } from "@/data/storefront-experience";
import { StorefrontStateProvider } from "@/context/storefront-state";
import { DEFAULT_STOREFRONT_STATE } from "@/shared/storefront-state";

jest.mock("next/navigation", () => {
  const actual = jest.requireActual("next/navigation");
  return {
    ...actual,
    useRouter: () => ({
      replace: jest.fn()
    }),
    usePathname: () => "/products",
    useSearchParams: () => new URLSearchParams()
  };
});

const renderWithProvider = (ui: React.ReactNode) =>
  render(<StorefrontStateProvider initialState={DEFAULT_STOREFRONT_STATE}>{ui}</StorefrontStateProvider>);

describe("ProductShowcase", () => {
  it("renders all products by default and filters by platform", () => {
    renderWithProvider(<ProductShowcase products={storefrontExperience.products} platforms={storefrontExperience.platforms} />);

    expect(screen.getByText("Instagram Creator Growth Kit")).toBeInTheDocument();
    expect(screen.getByText("TikTok Retention Drive")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /TikTok/i }));

    expect(screen.queryByText("Instagram Creator Growth Kit")).not.toBeInTheDocument();
    expect(screen.getByText("TikTok Retention Drive")).toBeInTheDocument();
  });

  it("displays a helpful empty state when no products match", () => {
    const onlyInstagram = storefrontExperience.products.filter((product) => product.id === "instagram-growth-kit");
    renderWithProvider(<ProductShowcase products={onlyInstagram} platforms={storefrontExperience.platforms} />);

    fireEvent.click(screen.getByRole("button", { name: /TikTok/i }));

    expect(
      screen.getByText(/No products match this platform yet—stay tuned as we expand coverage./i)
    ).toBeInTheDocument();
  });
});
