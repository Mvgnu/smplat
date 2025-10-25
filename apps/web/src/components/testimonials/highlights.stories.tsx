import type { Meta, StoryObj } from "@storybook/react";

import { TestimonialHighlights } from "./highlights";

const meta: Meta<typeof TestimonialHighlights> = {
  title: "Components/Testimonials/Highlights",
  component: TestimonialHighlights,
  parameters: {
    backgrounds: {
      default: "dark"
    }
  }
};

export default meta;

type Story = StoryObj<typeof TestimonialHighlights>;

export const Default: Story = {
  args: {
    items: [
      {
        quote: "SMPLAT helped us launch a premium storefront in record time, letting our team focus on delivering results for clients.",
        author: "Alex Fischer",
        role: "Managing Director",
        company: "GrowthWave Agency"
      },
      {
        quote: "Automation tooling cut our manual fulfillment time by 60% without sacrificing quality.",
        author: "Lina Berger",
        role: "COO",
        company: "Spotlight Social"
      }
    ]
  }
};
