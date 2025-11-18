import type { Meta, StoryObj } from "@storybook/react";

import { storefrontExperience } from "@/data/storefront-experience";

import { StorefrontProductCard } from "./product-listing-card";

const [primaryProduct, secondaryProduct] = storefrontExperience.products;
const platformLookup = storefrontExperience.platforms.reduce<Record<string, (typeof storefrontExperience.platforms)[number]>>(
  (acc, platform) => {
    acc[platform.id] = platform;
    return acc;
  },
  {}
);

const meta: Meta<typeof StorefrontProductCard> = {
  title: "Components/Storefront/ProductListingCard",
  component: StorefrontProductCard,
  parameters: {
    backgrounds: {
      default: "dark"
    }
  },
  args: {
    product: primaryProduct,
    platformLookup
  }
};

export default meta;

type Story = StoryObj<typeof StorefrontProductCard>;

export const Default: Story = {};

export const LoyaltyFocused: Story = {
  args: {
    product: {
      ...secondaryProduct,
      loyaltyHint: {
        ...secondaryProduct.loyaltyHint,
        progress: 0.9,
        value: "Earn 9,800 pts"
      }
    },
    footerHint: "High-value loyalty campaigns surface here so ops can coordinate quick intents."
  }
};
