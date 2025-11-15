"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createPricingExperiment,
  updatePricingExperiment,
  recordPricingExperimentEvent,
} from "@/server/catalog/pricing-experiments";

export type ActionState = {
  success: boolean;
  error: string | null;
};

export const initialActionState: ActionState = {
  success: false,
  error: null,
};

const variantSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  weight: z.number().int().min(0).max(10_000).default(0),
  isControl: z.boolean().default(false),
  adjustmentKind: z.enum(["delta", "multiplier"]).default("delta"),
  priceDeltaCents: z.number().int(),
  priceMultiplier: z.number().nullable().optional(),
});

const createSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
  targetProductSlug: z.string().min(1),
  targetSegment: z.string().nullish(),
  featureFlagKey: z.string().nullish(),
  assignmentStrategy: z.string().min(1),
  variants: z.array(variantSchema).min(1),
});

const updateSchema = z.object({
  slug: z.string().min(1),
  status: z.string().optional(),
  targetSegment: z.string().nullish(),
  featureFlagKey: z.string().nullish(),
  assignmentStrategy: z.string().nullish(),
});

const eventSchema = z.object({
  slug: z.string().min(1),
  variantKey: z.string().min(1),
  exposures: z.number().int().min(0).default(0),
  conversions: z.number().int().min(0).default(0),
  revenueCents: z.number().int().default(0),
  windowStart: z.string().nullish(),
});

function parseVariants(raw: FormDataEntryValue | null): z.infer<typeof variantSchema>[] {
  if (!raw || typeof raw !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((entry) =>
      variantSchema.parse({
        key: entry.key,
        name: entry.name,
        description: entry.description ?? null,
        weight: Number(entry.weight ?? 0),
        isControl: Boolean(entry.isControl ?? entry.is_control ?? false),
        adjustmentKind: entry.adjustmentKind ?? entry.adjustment_kind ?? "delta",
        priceDeltaCents: Number(entry.priceDeltaCents ?? entry.price_delta_cents ?? 0),
        priceMultiplier:
          entry.priceMultiplier != null ? Number(entry.priceMultiplier) : entry.price_multiplier ?? null,
      }),
    );
  } catch (error) {
    console.warn("Failed to parse pricing experiment variants payload", error);
    return [];
  }
}

export async function createPricingExperimentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const variants = parseVariants(formData.get("variants"));
  const result = createSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    description: formData.get("description") || null,
    targetProductSlug: formData.get("targetProductSlug"),
    targetSegment: formData.get("targetSegment") || null,
    featureFlagKey: formData.get("featureFlagKey") || null,
    assignmentStrategy: formData.get("assignmentStrategy"),
    variants,
  });

  if (!result.success) {
    return {
      success: false,
      error: "Please fix the highlighted fields before submitting.",
    };
  }

  try {
    await createPricingExperiment({
      slug: result.data.slug,
      name: result.data.name,
      description: result.data.description,
      targetProductSlug: result.data.targetProductSlug,
      targetSegment: result.data.targetSegment,
      featureFlagKey: result.data.featureFlagKey,
      assignmentStrategy: result.data.assignmentStrategy,
      variants: result.data.variants,
    });
    revalidatePath("/admin/merchandising/pricing-experiments");
    return { success: true, error: null };
  } catch (error) {
    console.error("Failed to create pricing experiment", error);
    return { success: false, error: error instanceof Error ? error.message : "Failed to create experiment." };
  }
}

export async function updatePricingExperimentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = updateSchema.safeParse({
    slug: formData.get("slug"),
    status: formData.get("status") || undefined,
    targetSegment: formData.get("targetSegment") || null,
    featureFlagKey: formData.get("featureFlagKey") || null,
    assignmentStrategy: formData.get("assignmentStrategy") || null,
  });

  if (!result.success) {
    return { success: false, error: "Invalid update payload." };
  }

  try {
    await updatePricingExperiment(result.data.slug, {
      status: result.data.status,
      targetSegment: result.data.targetSegment,
      featureFlagKey: result.data.featureFlagKey,
      assignmentStrategy: result.data.assignmentStrategy,
    });
    revalidatePath("/admin/merchandising/pricing-experiments");
    return { success: true, error: null };
  } catch (error) {
    console.error("Failed to update pricing experiment", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update experiment.",
    };
  }
}

export async function recordPricingExperimentEventAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = eventSchema.safeParse({
    slug: formData.get("slug"),
    variantKey: formData.get("variantKey"),
    exposures: Number(formData.get("exposures") ?? 0),
    conversions: Number(formData.get("conversions") ?? 0),
    revenueCents: Number(formData.get("revenueCents") ?? 0),
    windowStart: formData.get("windowStart") || null,
  });

  if (!result.success) {
    return { success: false, error: "Invalid metric payload." };
  }

  try {
    await recordPricingExperimentEvent(result.data.slug, {
      variantKey: result.data.variantKey,
      exposures: result.data.exposures,
      conversions: result.data.conversions,
      revenueCents: result.data.revenueCents,
      windowStart: result.data.windowStart,
    });
    revalidatePath("/admin/merchandising/pricing-experiments");
    return { success: true, error: null };
  } catch (error) {
    console.error("Failed to record pricing experiment event", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to log metrics.",
    };
  }
}
