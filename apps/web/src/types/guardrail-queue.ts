import type { GuardrailAlert, GuardrailFollowUpEntry } from "@/types/reporting";

export type GuardrailQueueEntry = {
  providerId: string;
  providerName: string;
  providerHref: string;
  action: GuardrailFollowUpEntry["action"];
  severity: GuardrailAlert["severity"];
  isPaused: boolean;
  notes: string | null;
  createdAt: string;
  platformContext: GuardrailFollowUpEntry["platformContext"];
  attachments: GuardrailFollowUpEntry["attachments"];
  conversionCursor: GuardrailFollowUpEntry["conversionCursor"];
  conversionHref: GuardrailFollowUpEntry["conversionHref"];
};
