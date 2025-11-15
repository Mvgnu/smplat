import "server-only";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export type OrderProgressStep = {
  name: string;
  completed: boolean;
  completedAt: string | null;
};

export type OrderProgress = {
  orderId: string;
  orderStatus: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  progressPercentage: number;
  itemsCount: number;
  totalSteps: number;
  completedSteps: number;
  nextStep: string | null;
  steps: OrderProgressStep[];
};

type OrderProgressPayload = {
  order_id: string;
  order_status: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  in_progress_tasks: number;
  progress_percentage: number;
  items_count: number;
  total_steps?: number | null;
  completed_steps?: number | null;
  next_step?: string | null;
  steps?: unknown;
};

const emptyProgress: OrderProgress = {
  orderId: "",
  orderStatus: "",
  totalTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
  inProgressTasks: 0,
  progressPercentage: 0,
  itemsCount: 0,
  totalSteps: 0,
  completedSteps: 0,
  nextStep: null,
  steps: []
};

function normalizeSteps(raw: unknown): OrderProgressStep[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const step = entry as Record<string, unknown>;
      const name = typeof step.name === "string" && step.name.trim().length > 0 ? step.name.trim() : null;
      if (!name) {
        return null;
      }
      const completed =
        typeof step.completed === "boolean"
          ? step.completed
          : typeof step.status === "string"
            ? step.status.toLowerCase() === "completed"
            : false;
      const completedAt =
        typeof step.completed_at === "string" && step.completed_at.length > 0
          ? step.completed_at
          : null;
      return {
        name,
        completed,
        completedAt
      } satisfies OrderProgressStep;
    })
    .filter((value): value is OrderProgressStep => value != null);
}

export async function fetchOrderProgress(orderId: string): Promise<OrderProgress | null> {
  if (!orderId) {
    return null;
  }

  if (!checkoutApiKey) {
    return null;
  }

  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/orders/${orderId}/progress`, {
      headers: {
        "X-API-Key": checkoutApiKey
      },
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as OrderProgressPayload;
    const steps = normalizeSteps(payload.steps);
    const completedSteps =
      typeof payload.completed_steps === "number" && Number.isFinite(payload.completed_steps)
        ? payload.completed_steps
        : steps.length > 0
          ? steps.filter((step) => step.completed).length
          : Number(payload.completed_tasks ?? emptyProgress.completedTasks);
    const totalSteps =
      typeof payload.total_steps === "number" && Number.isFinite(payload.total_steps)
        ? payload.total_steps
        : steps.length > 0
          ? steps.length
          : Number(payload.total_tasks ?? emptyProgress.totalTasks);
    const nextStep =
      typeof payload.next_step === "string" && payload.next_step.trim().length > 0
        ? payload.next_step.trim()
        : null;

    return {
      orderId: payload.order_id ?? emptyProgress.orderId,
      orderStatus: payload.order_status ?? emptyProgress.orderStatus,
      totalTasks: Number(payload.total_tasks ?? emptyProgress.totalTasks),
      completedTasks: Number(payload.completed_tasks ?? emptyProgress.completedTasks),
      failedTasks: Number(payload.failed_tasks ?? emptyProgress.failedTasks),
      inProgressTasks: Number(payload.in_progress_tasks ?? emptyProgress.inProgressTasks),
      progressPercentage: Number(payload.progress_percentage ?? emptyProgress.progressPercentage),
      itemsCount: Number(payload.items_count ?? emptyProgress.itemsCount),
      completedSteps,
      totalSteps,
      nextStep,
      steps
    };
  } catch (error) {
    console.warn("Failed to fetch order progress snapshot", error);
    return null;
  }
}
