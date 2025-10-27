import { createHash } from "node:crypto";

import type { ZodIssue } from "zod";

import {
  marketingContentValidationSchema,
  type MarketingContentDocument
} from "./types";
import type { NormalizeLexicalBlockTrace } from "./lexical";

// meta: cms-validation: marketing-blocks

export type MarketingBlockValidationTrace = Pick<
  NormalizeLexicalBlockTrace,
  "blockType" | "sectionLabel" | "lexicalIndex" | "lexicalKey" | "provenance" | "operations" | "warnings" | "normalized" | "skipReason"
>;

export type MarketingBlockFallbackInsight = {
  used: boolean;
  reason?: string;
  source?: string;
};

export type MarketingBlockValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  block: MarketingContentDocument | null;
  kind?: MarketingContentDocument["kind"];
  key?: string;
  fingerprint?: string;
  recoveryHints: string[];
  trace: MarketingBlockValidationTrace;
  fallback?: MarketingBlockFallbackInsight;
};

const toFingerprint = (input: unknown): string | undefined => {
  try {
    return createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex");
  } catch {
    return undefined;
  }
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

const dedupe = (values: string[]): string[] => Array.from(new Set(values));

const ensureTrace = (
  block: MarketingContentDocument | null,
  trace?: MarketingBlockValidationTrace | NormalizeLexicalBlockTrace
): MarketingBlockValidationTrace => {
  if (trace) {
    return {
      blockType: trace.blockType ?? (block?.kind ?? trace.blockType),
      sectionLabel: trace.sectionLabel,
      lexicalIndex: trace.lexicalIndex,
      lexicalKey: trace.lexicalKey ?? (block ? (block as { key?: string }).key : trace.lexicalKey),
      provenance: trace.provenance,
      operations: [...trace.operations],
      warnings: [...trace.warnings],
      normalized: trace.normalized,
      skipReason: trace.skipReason
    };
  }

  return {
    blockType: block?.kind,
    sectionLabel: undefined,
    lexicalIndex: -1,
    lexicalKey: block ? (block as { key?: string }).key : undefined,
    provenance: "payload",
    operations: [],
    warnings: [],
    normalized: Boolean(block),
    skipReason: block ? undefined : "Marketing block was not provided for validation."
  };
};

const deriveFallbackInsight = (
  trace?: MarketingBlockValidationTrace
): MarketingBlockFallbackInsight | undefined => {
  if (!trace) {
    return undefined;
  }

  const fallbackSignals = trace.operations.filter((operation) => {
    const normalized = operation.toLowerCase();
    return normalized.includes("fallback") || normalized.includes("hydrated");
  });

  if (fallbackSignals.length === 0) {
    if (trace.skipReason || trace.provenance) {
      return {
        used: false,
        reason: trace.skipReason,
        source: trace.provenance
      };
    }
    return { used: false };
  }

  return {
    used: true,
    reason: fallbackSignals[0],
    source: trace.provenance
  };
};

const deriveRecoveryHints = (
  errors: string[],
  warnings: string[],
  trace: MarketingBlockValidationTrace
): string[] => {
  const hints = new Set<string>();

  if (errors.length > 0) {
    hints.add("Resolve schema validation errors in Payload for this block.");
  }

  for (const error of errors) {
    const normalized = error.toLowerCase();
    if (normalized.includes("quote")) {
      hints.add("Populate the testimonial quote or confirm the referenced testimonial document.");
    }
    if (normalized.includes("metrics")) {
      hints.add("Ensure marketing metrics include labeled values or adjust fallback ordering.");
    }
    if (normalized.includes("cta")) {
      hints.add("Confirm CTA labels and href values are populated for this block.");
    }
  }

  if (warnings.length > 0) {
    hints.add("Review warning signals before promoting this block.");
  }

  if (trace.skipReason) {
    hints.add(trace.skipReason);
  }

  if (!trace.normalized) {
    hints.add("Inspect the Lexical payload for this block; normalization was skipped.");
  }

  if (trace.operations.some((operation) => operation.toLowerCase().includes("hydrated"))) {
    hints.add("Verify referenced relationship content supplying fallback values.");
  }

  if (trace.operations.some((operation) => operation.toLowerCase().includes("fallback"))) {
    hints.add("Revisit marketing fallback fixtures or governance ordering for this block.");
  }

  return Array.from(hints);
};

export const validateMarketingBlock = (
  block: MarketingContentDocument | null,
  traceInput?: MarketingBlockValidationTrace | NormalizeLexicalBlockTrace
): MarketingBlockValidationResult => {
  const trace = ensureTrace(block, traceInput);
  const fallback = deriveFallbackInsight(trace);

  if (!block) {
    const errors = trace.skipReason ? [trace.skipReason] : ["Marketing block could not be normalized."];
    const warnings = dedupe(trace.warnings);
    const recoveryHints = deriveRecoveryHints(errors, warnings, trace);
    return {
      valid: false,
      errors,
      warnings,
      block: null,
      kind: trace.blockType,
      key: trace.lexicalKey,
      fingerprint: undefined,
      recoveryHints,
      trace: { ...trace, warnings },
      fallback
    };
  }

  const result = marketingContentValidationSchema.safeParse(block);

  if (!result.success) {
    const errors = result.error.issues.map(formatIssue);
    const warnings = dedupe(trace.warnings);
    const recoveryHints = deriveRecoveryHints(errors, warnings, trace);
    return {
      valid: false,
      errors,
      warnings,
      block: null,
      kind: block.kind,
      key: (block as { key?: string }).key,
      fingerprint: toFingerprint(block),
      recoveryHints,
      trace: { ...trace, blockType: trace.blockType ?? block.kind, warnings },
      fallback
    };
  }

  const sanitized = result.data;
  const combinedWarnings = dedupe([...trace.warnings, ...collectWarnings(sanitized)]);
  const recoveryHints = deriveRecoveryHints([], combinedWarnings, {
    ...trace,
    blockType: sanitized.kind,
    normalized: true,
    warnings: combinedWarnings
  });

  return {
    valid: true,
    errors: [],
    warnings: combinedWarnings,
    block: sanitized,
    kind: sanitized.kind,
    key: sanitized.key,
    fingerprint: toFingerprint(sanitized),
    recoveryHints,
    trace: {
      ...trace,
      blockType: sanitized.kind,
      normalized: true,
      warnings: combinedWarnings
    },
    fallback
  };
};
