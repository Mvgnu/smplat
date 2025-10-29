// meta: module: checkout-types

export type CheckoutStage =
  | "payment"
  | "verification"
  | "loyalty_hold"
  | "fulfillment"
  | "completed";

export type CheckoutStatus =
  | "not_started"
  | "in_progress"
  | "waiting"
  | "completed"
  | "failed";

export type CheckoutOrchestrationEvent = {
  stage: CheckoutStage;
  status: CheckoutStatus;
  note: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type CheckoutOrchestration = {
  orderId: string;
  currentStage: CheckoutStage;
  status: CheckoutStatus;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  nextActionAt: string | null;
  metadata: Record<string, unknown>;
  events: CheckoutOrchestrationEvent[];
};
