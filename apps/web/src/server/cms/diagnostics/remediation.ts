import type { MarketingBlockRecoveryHint } from "@/server/cms/validation";
import {
  REMEDIATION_INDEX,
  type RemediationPlaybook,
  type RemediationCategory
} from "@/shared/marketing/remediation";

// meta: module: remediation-server
// meta: feature: marketing-preview-diagnostics

export type ResolvedRemediationPlaybook = RemediationPlaybook & {
  matchedCategories: RemediationCategory[];
  matchedFields: string[];
};

export const resolveRemediationPlaybooks = (
  hints: MarketingBlockRecoveryHint[]
): ResolvedRemediationPlaybook[] => {
  const results: ResolvedRemediationPlaybook[] = [];
  const categoryFields = new Map<RemediationCategory, Set<string>>();

  for (const hint of hints) {
    const fields = categoryFields.get(hint.category) ?? new Set<string>();
    if (hint.fieldPath) {
      fields.add(hint.fieldPath);
    }
    categoryFields.set(hint.category, fields);
  }

  for (const [category, fields] of categoryFields.entries()) {
    const playbooks = REMEDIATION_INDEX[category] ?? [];
    for (const playbook of playbooks) {
      results.push({
        ...playbook,
        matchedCategories: [category],
        matchedFields: Array.from(fields)
      });
    }
  }

  return results;
};
