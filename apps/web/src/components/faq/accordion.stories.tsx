import type { Meta, StoryObj } from "@storybook/react";

import { FaqAccordion } from "./accordion";

const meta: Meta<typeof FaqAccordion> = {
  title: "Components/FAQ/Accordion",
  component: FaqAccordion,
  parameters: {
    backgrounds: {
      default: "dark"
    }
  }
};

export default meta;

type Story = StoryObj<typeof FaqAccordion>;

export const Default: Story = {
  args: {
    items: [
      {
        question: "How quickly can we launch a storefront?",
        answer: "Most agencies go live within 3-4 weeks thanks to automation templates."
      },
      {
        question: "Do you support subscriptions and one-off services?",
        answer: "Yes, products can be configured as one-time campaigns or recurring retainers."
      }
    ]
  }
};
