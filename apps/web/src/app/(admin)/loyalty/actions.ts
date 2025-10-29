"use server";

// meta: module: admin-loyalty-guardrail-actions

import { revalidatePath } from "next/cache";

import type { LoyaltyGuardrailOverrideScope, LoyaltyGuardrailOverride } from "@smplat/types";

import { requireRole } from "@/server/auth/policies";
import { createGuardrailOverride } from "@/server/loyalty/guardrails";
import { ensureCsrfToken } from "@/server/security/csrf";

export type GuardrailOverrideFormInput = {
  scope: LoyaltyGuardrailOverrideScope;
  justification: string;
  targetMemberId?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown> | null;
  csrfToken: string;
};

export async function submitGuardrailOverride(
  input: GuardrailOverrideFormInput
): Promise<LoyaltyGuardrailOverride> {
  const { session } = await requireRole("operator");
  ensureCsrfToken({ tokenFromForm: input.csrfToken });

  const override = await createGuardrailOverride({
    scope: input.scope,
    justification: input.justification,
    actorUserId: session.user?.id ?? null,
    targetMemberId: input.targetMemberId ?? null,
    expiresAt: input.expiresAt ?? null,
    metadata: input.metadata ?? {}
  });

  revalidatePath("/admin/loyalty");
  return override;
}

export type GuardrailOverrideFormState = {
  error?: string;
  success?: string;
};

export const guardrailOverrideInitialState: GuardrailOverrideFormState = {};

export async function guardrailOverrideAction(
  _prev: GuardrailOverrideFormState,
  formData: FormData
): Promise<GuardrailOverrideFormState> {
  try {
    const scope = formData.get("scope");
    const justification = formData.get("justification");
    const targetMemberId = formData.get("targetMemberId");
    const expiresInMinutes = formData.get("expiresInMinutes");
    const csrfToken = formData.get("csrfToken");
    const notes = formData.get("notes");

    if (typeof scope !== "string" || !scope) {
      return { error: "Select a guardrail to override." };
    }

    if (typeof justification !== "string" || justification.trim().length < 3) {
      return { error: "Provide an operator justification." };
    }

    if (typeof csrfToken !== "string" || csrfToken.length === 0) {
      return { error: "Missing CSRF token." };
    }

    let expiresAt: string | null = null;
    if (typeof expiresInMinutes === "string" && expiresInMinutes) {
      const minutes = Number(expiresInMinutes);
      if (!Number.isNaN(minutes) && minutes > 0) {
        expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
      }
    }

    const metadata = typeof notes === "string" && notes.trim().length > 0 ? { notes: notes.trim() } : {};

    await submitGuardrailOverride({
      scope: scope as LoyaltyGuardrailOverrideScope,
      justification: justification.trim(),
      targetMemberId: typeof targetMemberId === "string" && targetMemberId ? targetMemberId : null,
      expiresAt,
      metadata,
      csrfToken
    });

    return { success: "Override created" };
  } catch (error) {
    console.error("Failed to create guardrail override", error);
    return {
      error: error instanceof Error ? error.message : "Unexpected error creating override"
    };
  }
}
