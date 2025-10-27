import type { ZodIssue } from "zod";

import {
  marketingContentValidationSchema,
  type MarketingContentDocument
} from "./types";

// meta: cms-validation: marketing-blocks

export type MarketingBlockValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  block: MarketingContentDocument | null;
  kind?: MarketingContentDocument["kind"];
  key?: string;
};

const formatIssue = (issue: ZodIssue) => {
  const path = issue.path.length ? issue.path.join(".") : "value";
  return `${path}: ${issue.message}`;
};

const collectWarnings = (block: MarketingContentDocument): string[] => {
  const warnings: string[] = [];

  if (block.kind === "hero" && !block.headline) {
    warnings.push("Hero block is missing a headline.");
  }

  if (block.kind === "product" && (!Array.isArray(block.features) || block.features.length === 0)) {
    warnings.push("Product block should include at least one feature.");
  }

  return warnings;
};

export const validateMarketingBlock = (
  block: MarketingContentDocument
): MarketingBlockValidationResult => {
  const result = marketingContentValidationSchema.safeParse(block);

  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map(formatIssue),
      warnings: [],
      block: null,
      kind: block?.kind,
      key: (block as { key?: string }).key
    };
  }

  const sanitized = result.data;

  return {
    valid: true,
    errors: [],
    warnings: collectWarnings(sanitized),
    block: sanitized,
    kind: sanitized.kind,
    key: sanitized.key
  };
};
