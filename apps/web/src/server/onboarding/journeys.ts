import "server-only";

// meta: module: onboarding-journeys-client

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export type OnboardingTaskPayload = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  sort_order: number;
  due_at: string | null;
  completed_at: string | null;
};

export type OnboardingJourneyPayload = {
  id: string;
  order_id: string;
  status: string;
  progress_percentage: number;
  referral_code: string | null;
  started_at: string | null;
  completed_at: string | null;
  tasks: OnboardingTaskPayload[];
};

export type OperatorJourneySummary = {
  journeyId: string;
  orderId: string;
  orderNumber: string | null;
  status: string;
  riskLevel: string;
  progressPercentage: number;
  referralCode: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  lastInteractionAt: string | null;
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  awaitingArtifacts: number;
};

export type OperatorJourneyAggregates = {
  total: number;
  active: number;
  stalled: number;
  completed: number;
  withReferrals: number;
};

export type OperatorArtifact = {
  id: string;
  label: string;
  required: boolean;
  receivedAt: string | null;
  url: string | null;
};

export type OperatorTask = {
  id: string;
  slug: string;
  title: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
};

export type OperatorInteraction = {
  id: string;
  actor: string;
  channel: string;
  summary: string | null;
  details: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

export type OperatorNudgeOpportunity = {
  journeyId: string;
  orderId: string;
  orderNumber: string | null;
  taskId: string | null;
  taskSlug: string | null;
  reason: string;
  dedupeKey: string;
  idleHours: number;
  recommendedChannel: string;
  slaExpiresAt: string;
  subject: string;
  message: string;
};

export type OperatorJourneyDetail = {
  journeyId: string;
  orderId: string;
  orderNumber: string | null;
  status: string;
  riskLevel: string;
  progressPercentage: number;
  referralCode: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  tasks: OperatorTask[];
  artifacts: OperatorArtifact[];
  interactions: OperatorInteraction[];
  nudgeOpportunities: OperatorNudgeOpportunity[];
};

export type OperatorJourneySummaryResponse = {
  summaries: OperatorJourneySummary[];
  aggregates: OperatorJourneyAggregates;
};

const defaultHeaders = checkoutApiKey
  ? { "X-API-Key": checkoutApiKey, "Content-Type": "application/json" }
  : { "Content-Type": "application/json" };

function assertOrder(orderId: string): asserts orderId {
  if (!orderId) {
    throw new Error("orderId is required for onboarding requests");
  }
}

export async function ensureOnboardingJourney(
  orderId: string,
  payload: Record<string, unknown>
): Promise<OnboardingJourneyPayload | null> {
  assertOrder(orderId);
  if (!checkoutApiKey) {
    return null;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/onboarding`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Failed to persist onboarding journey: ${response.statusText}`);
  }

  return (await response.json()) as OnboardingJourneyPayload;
}

export async function fetchOnboardingJourney(orderId: string): Promise<OnboardingJourneyPayload | null> {
  assertOrder(orderId);
  if (!checkoutApiKey) {
    return null;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/onboarding`, {
    headers: defaultHeaders,
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch onboarding journey: ${response.statusText}`);
  }

  return (await response.json()) as OnboardingJourneyPayload;
}

export async function toggleOnboardingTask(
  orderId: string,
  taskId: string,
  completed: boolean
): Promise<OnboardingTaskPayload> {
  assertOrder(orderId);
  if (!checkoutApiKey) {
    throw new Error("CHECKOUT_API_KEY must be configured to update onboarding tasks");
  }

  const response = await fetch(
    `${apiBaseUrl}/api/v1/orders/${orderId}/onboarding/tasks/${taskId}`,
    {
      method: "PATCH",
      headers: defaultHeaders,
      body: JSON.stringify({ completed })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to toggle onboarding task: ${response.statusText}`);
  }

  return (await response.json()) as OnboardingTaskPayload;
}

export async function recordOnboardingReferral(
  orderId: string,
  referralCode: string
): Promise<void> {
  assertOrder(orderId);
  if (!checkoutApiKey) {
    return;
  }

  const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/onboarding/referral`, {
    method: "POST",
    headers: defaultHeaders,
    body: JSON.stringify({ referral_code: referralCode })
  });

  if (!response.ok) {
    throw new Error(`Failed to record onboarding referral: ${response.statusText}`);
  }
}

export async function fetchOperatorJourneys(
  params: {
    status?: string[];
    stalled?: boolean;
    referrals?: boolean;
    search?: string | null;
    limit?: number;
  } = {}
): Promise<OperatorJourneySummaryResponse> {
  if (!checkoutApiKey) {
    throw new Error("CHECKOUT_API_KEY must be configured for operator onboarding queries");
  }

  const url = new URL(`${apiBaseUrl}/api/v1/operators/onboarding/journeys`);
  if (params.status?.length) {
    params.status.forEach((value) => url.searchParams.append("status", value));
  }
  if (params.stalled) {
    url.searchParams.set("stalled", "true");
  }
  if (params.referrals) {
    url.searchParams.set("referrals", "true");
  }
  if (params.search) {
    url.searchParams.set("search", params.search);
  }
  if (params.limit) {
    url.searchParams.set("limit", String(params.limit));
  }

  const response = await fetch(url.toString(), {
    headers: defaultHeaders,
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Failed to load operator onboarding journeys: ${response.statusText}`);
  }

  return (await response.json()) as OperatorJourneySummaryResponse;
}

export async function fetchOperatorJourneyDetail(journeyId: string): Promise<OperatorJourneyDetail> {
  if (!checkoutApiKey) {
    throw new Error("CHECKOUT_API_KEY must be configured for operator onboarding queries");
  }

  const response = await fetch(
    `${apiBaseUrl}/api/v1/operators/onboarding/journeys/${journeyId}`,
    {
      headers: defaultHeaders,
      cache: "no-store"
    }
  );

  if (response.status === 404) {
    throw new Error("Journey not found");
  }

  if (!response.ok) {
    throw new Error(`Failed to load journey detail: ${response.statusText}`);
  }

  return (await response.json()) as OperatorJourneyDetail;
}

export async function dispatchOperatorManualNudge(
  journeyId: string,
  payload: {
    channel: string;
    subject: string;
    message: string;
    taskId?: string | null;
    triggeredBy: string;
  }
): Promise<void> {
  if (!checkoutApiKey) {
    throw new Error("CHECKOUT_API_KEY must be configured for operator onboarding mutations");
  }

  const response = await fetch(
    `${apiBaseUrl}/api/v1/operators/onboarding/journeys/${journeyId}/nudges/manual`,
    {
      method: "POST",
      headers: defaultHeaders,
      body: JSON.stringify({
        channel: payload.channel,
        subject: payload.subject,
        message: payload.message,
        taskId: payload.taskId ?? null,
        triggeredBy: payload.triggeredBy
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to dispatch manual nudge: ${response.statusText}`);
  }
}
