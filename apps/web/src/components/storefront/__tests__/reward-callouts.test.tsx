import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";

import { RewardCallouts } from "../reward-callouts";
import { storefrontExperience } from "@/data/storefront-experience";

describe("RewardCallouts", () => {
  it("renders reward callouts with progress indicator", () => {
    render(<RewardCallouts rewards={storefrontExperience.rewards} />);

    expect(screen.getByText(storefrontExperience.rewards.heading)).toBeInTheDocument();

    const callout = storefrontExperience.rewards.callouts[0];
    const progress = screen.getByTestId(`reward-progress-${callout.id}`);
    expect(progress).toHaveStyle(`width: ${Math.round(callout.progress * 100)}%`);
  });
});

