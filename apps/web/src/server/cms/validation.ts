import { createHash } from "node:crypto";

import type { ZodIssue } from "zod";

import {
  marketingContentValidationSchema,
  type MarketingContentDocument
} from "./types";
import type { NormalizeLexicalBlockTrace } from "./lexical";
import type { RemediationCategory } from "@/shared/marketing/remediation";

// meta: cms-validation: marketing-blocks

type BaseLexicalTrace = Pick<
  NormalizeLexicalBlockTrace,
  "blockType" | "sectionLabel" | "lexicalIndex" | "lexicalKey" | "provenance" | "operations" | "warnings" | "normalized" | "skipReason"
>;

export type MarketingBlockValidationTrace = Omit<BaseLexicalTrace, "blockType"> & {
  blockType?: MarketingContentDocument["kind"] | string;
};

export type MarketingBlockFallbackInsight = {
  used: boolean;
  reason?: string;
  source?: string;
};

export type MarketingBlockRecoveryHintCategory = RemediationCategory;

export type MarketingBlockRecoveryHint = {
  message: string;
  category: MarketingBlockRecoveryHintCategory;
  fieldPath?: string;
};

export type MarketingBlockValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  block: MarketingContentDocument | null;
  kind?: MarketingContentDocument["kind"];
  key?: string;
  fingerprint?: string;
  recoveryHints: MarketingBlockRecoveryHint[];
  trace: MarketingBlockValidationTrace;
  fallback?: MarketingBlockFallbackInsight;
};

const KNOWN_MARKETING_BLOCK_KINDS: ReadonlyArray<MarketingContentDocument["kind"]> = [
  "hero",
  "metrics",
  "testimonial",
  "product",
  "timeline",
  "feature-grid",
  "media-gallery",
  "cta-cluster",
  "comparison-table"
];

const normalizeBlockKind = (value: unknown): MarketingContentDocument["kind"] | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  return (KNOWN_MARKETING_BLOCK_KINDS as ReadonlyArray<string>).includes(value)
    ? (value as MarketingContentDocument["kind"])
    : undefined;
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

const addRecoveryHint = (
  hints: Map<string, MarketingBlockRecoveryHint>,
  hint: MarketingBlockRecoveryHint
) => {
  const key = `${hint.category}:${hint.message}:${hint.fieldPath ?? ""}`;
  if (!hints.has(key)) {
    hints.set(key, hint);
  }
};

const deriveRecoveryHints = (
  errors: string[],
  warnings: string[],
  trace: MarketingBlockValidationTrace
): MarketingBlockRecoveryHint[] => {
  const hints = new Map<string, MarketingBlockRecoveryHint>();

  for (const error of errors) {
    const [path, rawMessage] = error.includes(":") ? error.split(/:(.+)/).map((value) => value.trim()) : ["value", error];
    addRecoveryHint(hints, {
      message: rawMessage,
      category: "schema",
      fieldPath: path
    });

    const normalized = rawMessage.toLowerCase();
    if (normalized.includes("missing") || normalized.includes("required")) {
      addRecoveryHint(hints, {
        message: "Populate required fields for this marketing block.",
        category: "content-gap",
        fieldPath: path
      });
    }
    if (normalized.includes("metrics")) {
      addRecoveryHint(hints, {
        message: "Ensure marketing metrics include labeled values or adjust fallback ordering.",
        category: "fallback",
        fieldPath: path
      });
    }
    if (normalized.includes("cta")) {
      addRecoveryHint(hints, {
        message: "Confirm CTA labels and href values are populated.",
        category: "content-gap",
        fieldPath: path
      });
    }
  }

  if (warnings.length > 0) {
    addRecoveryHint(hints, {
      message: "Review warning signals before promoting this block.",
      category: "content-gap",
      fieldPath: trace.blockType
    });
  }

  for (const warning of warnings) {
    addRecoveryHint(hints, {
      message: warning,
      category: "content-gap",
      fieldPath: trace.blockType
    });
  }

  if (trace.skipReason) {
    addRecoveryHint(hints, {
      message: trace.skipReason,
      category: "lexical"
    });
  }

  if (!trace.normalized) {
    addRecoveryHint(hints, {
      message: "Lexical normalization skipped for this block.",
      category: "lexical"
    });
  }

  if (trace.operations.some((operation) => operation.toLowerCase().includes("hydrated"))) {
    addRecoveryHint(hints, {
      message: "Verify referenced relationship content supplying fallback values.",
      category: "fallback"
    });
  }

  if (trace.operations.some((operation) => operation.toLowerCase().includes("fallback"))) {
    addRecoveryHint(hints, {
      message: "Revisit marketing fallback fixtures or governance ordering for this block.",
      category: "fallback"
    });
  }

  return Array.from(hints.values());
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
      kind: normalizeBlockKind(trace.blockType),
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
