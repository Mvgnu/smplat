import type { Meta, StoryObj } from "@storybook/react";

import { CaseStudyHighlight } from "./highlight";

const meta: Meta<typeof CaseStudyHighlight> = {
  title: "Components/CaseStudies/Highlight",
  component: CaseStudyHighlight,
  parameters: {
    backgrounds: {
      default: "dark"
    }
  }
};

export default meta;

type Story = StoryObj<typeof CaseStudyHighlight>;

export const Default: Story = {
  args: {
    caseStudy: {
      title: "Driving 4.2x ROI for a boutique agency",
      client: "Spotlight Social",
      industry: "Lifestyle & Fashion",
      summary: "Centralising checkout, reporting, and fulfillment tracking increased retention while cutting manual work by 60%.",
      results: [
        { label: "Retention uplift", value: "28%" },
        { label: "Fulfillment time saved", value: "60%" },
        { label: "New revenue streams", value: "3" }
      ],
      quote: "SMPLAT let us deliver a premium client experience without hiring an internal dev team.",
      quoteAuthor: "Amelia Novak, Founder"
    }
  }
};
