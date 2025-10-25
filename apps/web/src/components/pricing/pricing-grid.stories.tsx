import type { Meta, StoryObj } from "@storybook/react";

import { PricingGrid, type PricingTier } from "./pricing-grid";

const tiers: PricingTier[] = [
  {
    name: "Starter",
    description: "Launch services with templated workflows.",
    price: 149,
    currency: "EUR",
    features: ["Hosted storefront", "Stripe checkout", "Email notifications"],
    ctaLabel: "Start trial",
    ctaHref: "#",
    highlight: false
  },
  {
    name: "Growth",
    description: "Scale automation and reporting for multi-channel agencies.",
    price: 349,
    currency: "EUR",
    features: ["Client dashboards", "Instagram analytics", "Workflow automation"],
    ctaLabel: "Talk to sales",
    ctaHref: "#",
    highlight: true
  },
  {
    name: "Enterprise",
    description: "Custom integrations, dedicated success, and compliance tooling.",
    price: 0,
    currency: "EUR",
    features: ["Custom SLA", "Lexoffice integration", "Dedicated success manager"],
    ctaLabel: "Request quote",
    ctaHref: "#",
    highlight: false
  }
];

const meta: Meta<typeof PricingGrid> = {
  title: "Components/Pricing/PricingGrid",
  component: PricingGrid,
  parameters: {
    backgrounds: {
      default: "dark"
    }
  }
};

export default meta;

type Story = StoryObj<typeof PricingGrid>;

export const Default: Story = {
  args: {
    tiers
  }
};
