import { render, screen } from "@testing-library/react";

import type { CheckoutOrchestration } from "@smplat/types";
import { CheckoutRecoveryBanner } from "../recovery-banner";

describe("CheckoutRecoveryBanner", () => {
  const baseOrchestration: CheckoutOrchestration = {
    orderId: "order-123",
    currentStage: "payment",
    status: "waiting",
    startedAt: new Date().toISOString(),
    completedAt: null,
    failedAt: null,
    nextActionAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    metadata: {},
    events: [
      {
        stage: "payment",
        status: "waiting",
        note: "Awaiting verification",
        payload: {},
        createdAt: new Date().toISOString()
      }
    ]
  };

  it("renders loading placeholder", () => {
    render(
      <CheckoutRecoveryBanner
        orchestration={null}
        pendingIntents={0}
        loading
        error={null}
      />
    );

    expect(screen.getByRole("status", { hidden: true })).toBeInTheDocument();
  });

  it("renders orchestration details", () => {
    render(
      <CheckoutRecoveryBanner
        orchestration={baseOrchestration}
        pendingIntents={2}
        loading={false}
        error={null}
      />
    );

    expect(screen.getByText(/Checkout recovery in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/2 open steps/i)).toBeInTheDocument();
  });

  it("renders error state", () => {
    render(
      <CheckoutRecoveryBanner
        orchestration={null}
        pendingIntents={0}
        loading={false}
        error="Oops"
      />
    );

    expect(screen.getByText(/Failed to load checkout recovery status/i)).toBeInTheDocument();
  });
});
