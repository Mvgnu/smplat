import type { Meta, StoryObj } from "@storybook/react";

import { storefrontExperience } from "@/data/storefront-experience";

import { StorefrontHero } from "./hero";

const meta: Meta<typeof StorefrontHero> = {
  title: "Components/Storefront/Hero",
  component: StorefrontHero,
  args: {
    hero: storefrontExperience.hero
  },
  parameters: {
    backgrounds: {
      default: "dark"
    }
  }
};

export default meta;

type Story = StoryObj<typeof StorefrontHero>;

export const Default: Story = {};
