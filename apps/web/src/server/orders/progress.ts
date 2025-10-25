import "server-only";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export type OrderProgress = {
  orderId: string;
  orderStatus: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  inProgressTasks: number;
  progressPercentage: number;
  itemsCount: number;
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
};

const emptyProgress: OrderProgress = {
  orderId: "",
  orderStatus: "",
  totalTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
  inProgressTasks: 0,
  progressPercentage: 0,
  itemsCount: 0
};

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

    return {
      orderId: payload.order_id ?? emptyProgress.orderId,
      orderStatus: payload.order_status ?? emptyProgress.orderStatus,
      totalTasks: Number(payload.total_tasks ?? emptyProgress.totalTasks),
      completedTasks: Number(payload.completed_tasks ?? emptyProgress.completedTasks),
      failedTasks: Number(payload.failed_tasks ?? emptyProgress.failedTasks),
      inProgressTasks: Number(payload.in_progress_tasks ?? emptyProgress.inProgressTasks),
      progressPercentage: Number(payload.progress_percentage ?? emptyProgress.progressPercentage),
      itemsCount: Number(payload.items_count ?? emptyProgress.itemsCount)
    };
  } catch (error) {
    console.warn("Failed to fetch order progress snapshot", error);
    return null;
  }
}
