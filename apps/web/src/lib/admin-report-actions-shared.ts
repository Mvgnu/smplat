import type { MetricValidationResult } from "@/types/metrics";

export type GuardrailExportTriggerState = {
  status: "idle" | "success" | "error";
  message: string | null;
};

export const guardrailExportTriggerInitialState: GuardrailExportTriggerState = {
  status: "idle",
  message: null,
};

export type AccountValidationActionState = {
  status: "idle" | "submitting" | "success" | "error";
  message: string | null;
  result: MetricValidationResult | null;
};

export const accountValidationInitialState: AccountValidationActionState = {
  status: "idle",
  message: null,
  result: null,
};
