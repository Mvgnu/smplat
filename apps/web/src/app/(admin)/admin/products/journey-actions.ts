"use server";

import type { JourneyComponentRun } from "@smplat/types";

import { requireRole } from "@/server/auth/policies";
import { triggerJourneyComponentRun } from "@/server/journey-runtime";
import { ensureCsrfToken } from "@/server/security/csrf";

export type JourneyPreviewInput = {
  productId: string;
  productComponentId?: string | null;
  componentId: string;
  channel?: string | null;
  metadata?: Record<string, unknown> | null;
  csrfToken: string;
};

export type JourneyPreviewResult = {
  run: JourneyComponentRun;
};

export async function runJourneyComponentPreview(
  input: JourneyPreviewInput,
): Promise<JourneyPreviewResult> {
  await requireRole("operator", {
    context: { route: "admin.products.runJourneyPreview", method: "POST" },
  });
  ensureCsrfToken({ tokenFromForm: input.csrfToken });

  if (!input.productId) {
    throw new Error("Product identifier is required.");
  }
  if (!input.componentId) {
    throw new Error("Component identifier is required.");
  }

  const metadataPayload: Record<string, unknown> = {
    initiator: "admin_preview",
    surface: "products_composer",
  };
  if (input.metadata && typeof input.metadata === "object") {
    Object.assign(metadataPayload, input.metadata);
  }

  const run = await triggerJourneyComponentRun({
    componentId: input.componentId,
    productId: input.productId,
    productComponentId: input.productComponentId ?? undefined,
    channel: input.channel ?? "admin_preview",
    metadata: metadataPayload,
    inputPayload: {
      preview: true,
      initiatedAt: new Date().toISOString(),
    },
    context: {
      admin: {
        surface: "products_composer",
        initiator: "operator",
      },
    },
  });

  return { run };
}
