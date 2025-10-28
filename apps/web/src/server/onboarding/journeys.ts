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
