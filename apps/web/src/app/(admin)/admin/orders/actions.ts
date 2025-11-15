"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/server/auth/policies";
import { fetchAdminOrder, updateAdminOrderStatus } from "@/server/orders/admin-orders";
import { ensureCsrfToken } from "@/server/security/csrf";
import { serverTelemetry } from "@/server/observability/tracing";
import { fetchProductJourneyRuntime, triggerJourneyComponentRun } from "@/server/journey-runtime";
import { ORDER_STATUS_OPTIONS, type OrderStatus } from "./order-status";

export type UpdateOrderStatusState = {
  success: boolean;
  error?: string;
};

const initialState: UpdateOrderStatusState = { success: false };

export { initialState as updateOrderStatusInitialState };

export const updateOrderStatusAction = serverTelemetry.wrapServerAction(
  "admin.orders.updateStatus",
  async (_prevState: UpdateOrderStatusState, formData: FormData): Promise<UpdateOrderStatusState> => {
    await requireRole("operator", {
      context: {
        route: "admin.orders.updateStatus",
        method: "POST"
      }
    });
    const csrfToken = formData.get("csrfToken");
    ensureCsrfToken({ tokenFromForm: typeof csrfToken === "string" ? csrfToken : null });

    const orderId = formData.get("orderId");
    const status = formData.get("status");

    if (typeof orderId !== "string" || typeof status !== "string") {
      return { success: false, error: "Invalid form submission." };
    }

    if (!ORDER_STATUS_OPTIONS.includes(status as OrderStatus)) {
      return { success: false, error: "Unsupported status value." };
    }

    const didUpdate = await updateAdminOrderStatus(orderId, status);

    if (!didUpdate) {
      return { success: false, error: "Failed to update order status. Try again shortly." };
    }

    revalidatePath("/admin/orders");
    return { success: true };
  },
  { "server.action.feature": "orders" }
);

export type RunJourneyAutomationState = {
  success: boolean;
  error?: string;
  runsTriggered?: number;
};

const journeyAutomationInitialState: RunJourneyAutomationState = { success: false };

export { journeyAutomationInitialState as runOrderJourneyAutomationInitialState };

const AUTOMATION_STAGES = new Set(["automation", "post_checkout", "operator"]);

export const runOrderJourneyAutomationAction = serverTelemetry.wrapServerAction(
  "admin.orders.runJourneyAutomation",
  async (_prevState: RunJourneyAutomationState, formData: FormData): Promise<RunJourneyAutomationState> => {
    await requireRole("operator", {
      context: {
        route: "admin.orders.runJourneyAutomation",
        method: "POST",
      },
    });
    const csrfToken = formData.get("csrfToken");
    ensureCsrfToken({ tokenFromForm: typeof csrfToken === "string" ? csrfToken : null });

    const orderId = formData.get("orderId");
    if (typeof orderId !== "string" || !orderId) {
      return { success: false, error: "Order is required." };
    }

    const explicitProductId = formData.get("productId");
    const reasonRaw = formData.get("reason");
    const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";

    const order = await fetchAdminOrder(orderId);
    if (!order) {
      return { success: false, error: "Order not found." };
    }

    const selectedProductIds =
      typeof explicitProductId === "string" && explicitProductId.trim().length > 0
        ? [explicitProductId.trim()]
        : Array.from(new Set(order.items.map((item) => item.productId).filter((id): id is string => Boolean(id))));

    if (!selectedProductIds.length) {
      return { success: false, error: "Order does not contain journey-enabled products." };
    }

    let runsTriggered = 0;

    for (const productId of selectedProductIds) {
      const runtime = await fetchProductJourneyRuntime(productId);
      if (!runtime) {
        continue;
      }
      const automationAssignments = (runtime.journeyComponents ?? []).filter((assignment) => {
        const stages = assignment.component?.triggers?.map((trigger) => trigger.stage?.toLowerCase() ?? "") ?? [];
        if (!stages.length) {
          return true;
        }
        return stages.some((stage) => AUTOMATION_STAGES.has(stage));
      });
      if (!automationAssignments.length) {
        continue;
      }
      const matchingItems = order.items.filter((item) => item.productId === productId);
      await Promise.all(
        automationAssignments.map(async (assignment) => {
          try {
            await triggerJourneyComponentRun({
              componentId: assignment.componentId,
              productId,
              productComponentId: assignment.id,
              channel: "automation",
              metadata: {
                source: "admin_orders",
                componentKey: assignment.component?.key ?? undefined,
                orderNumber: order.orderNumber,
                reason: reason || undefined,
              },
              inputPayload: {
                order: {
                  id: order.id,
                  orderNumber: order.orderNumber,
                  status: order.status,
                  total: order.total,
                  currency: order.currency,
                },
                items: matchingItems,
              },
              context: {
                automation: {
                  initiatedBy: "operator",
                  surface: "admin_orders",
                },
              },
            });
            runsTriggered += 1;
          } catch (error) {
            console.warn("Failed to trigger journey automation run", {
              orderId,
              productId,
              componentId: assignment.componentId,
              error,
            });
          }
        }),
      );
    }

    if (!runsTriggered) {
      return {
        success: false,
        error: "No automation-ready journey components were found for this selection.",
      };
    }

    revalidatePath("/admin/orders");
    return { success: true, runsTriggered };
  },
  { "server.action.feature": "orders" },
);
