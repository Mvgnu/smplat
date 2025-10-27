import {
  MARKETING_BLOCK_TYPES,
  createMarketingContentFromBlock,
  isLexicalEditorState,
  toStringOrUndefined,
  type LexicalEditorState,
  type MarketingContent
} from "@/marketing/content";

const DEFAULT_MAX_DEPTH = 5;

type LexicalNode = {
  type?: unknown;
  children?: unknown;
  fields?: unknown;
};

type NormalizedBlock = {
  blockType: string;
  fields: Record<string, unknown>;
  lexicalKey?: string;
  lexicalIndex: number;
  warnings: string[];
  supported: boolean;
};

type WarnFn = (message: string) => string;

export type NormalizeLexicalBlockTrace = {
  blockType: string;
  lexicalIndex: number;
  lexicalKey?: string;
  sectionLabel?: string;
  provenance: "payload" | "fixture";
  operations: string[];
  warnings: string[];
  normalized: boolean;
  skipReason?: string;
};

export type NormalizedLexicalBlock = {
  node: MarketingContent | null;
  trace: NormalizeLexicalBlockTrace;
};

const hydrateField = (value: unknown, warn: WarnFn): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => hydrateField(item, warn));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const record = value as Record<string, unknown>;

  if (Array.isArray(record.docs)) {
    return record.docs.map((doc) => hydrateField(doc, warn));
  }

  if ("relationTo" in record && "value" in record) {
    const relationValue = record.value;
    if (!relationValue) {
      warn("Encountered relationship field without a populated value.");
      return undefined;
    }

    if (typeof relationValue === "string" || typeof relationValue === "number") {
      warn("Relationship field provided an identifier but was not populated with a document.");
      return undefined;
    }

    return hydrateField(relationValue, warn);
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, innerValue]) => [key, hydrateField(innerValue, warn)])
  );
};

const toHydratedFields = (fields: Record<string, unknown>, warn: WarnFn): Record<string, unknown> => {
  const hydrated = hydrateField(fields, warn);
  if (hydrated && typeof hydrated === "object" && !Array.isArray(hydrated)) {
    return hydrated as Record<string, unknown>;
  }
  return fields;
};

const collectSupportedBlocks = (
  state: LexicalEditorState,
  warn: WarnFn,
  maxDepth: number
): NormalizedBlock[] => {
  const blocks: NormalizedBlock[] = [];
  const unsupportedTypes = new Set<string>();

  const rootChildren = state.root?.children;
  if (!Array.isArray(rootChildren)) {
    warn("Lexical root is missing child nodes.");
    return blocks;
  }

  type Pending = { node: unknown; depth: number };
  const pending: Pending[] = rootChildren.map((child) => ({ node: child, depth: 1 }));
  let lexicalIndex = 0;

  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (!node || typeof node !== "object") {
      continue;
    }

    if (depth > maxDepth) {
      warn(`Lexical node depth ${depth} exceeded the allowed maximum of ${maxDepth}.`);
      continue;
    }

    const lexicalNode = node as LexicalNode;

    if (lexicalNode.type === "block") {
      const fields = lexicalNode.fields;
      const blockWarnings: string[] = [];
      const appendWarning = (message: string) => {
        const formatted = warn(message);
        blockWarnings.push(formatted);
        return formatted;
      };

      const rawFields = fields && typeof fields === "object" ? (fields as Record<string, unknown>) : undefined;
      const blockType = rawFields ? toStringOrUndefined(rawFields.blockType) : undefined;
      const lexicalKey = rawFields
        ? toStringOrUndefined(rawFields.id) ?? toStringOrUndefined(rawFields.key)
        : undefined;

      if (!rawFields) {
        appendWarning("Encountered block node without fields in lexical payload.");
        const currentIndex = lexicalIndex;
        lexicalIndex += 1;
        blocks.push({
          blockType: blockType ?? "unknown",
          fields: {},
          lexicalKey,
          lexicalIndex: currentIndex,
          warnings: blockWarnings,
          supported: false
        });
      } else if (!blockType) {
        appendWarning("Encountered block node without a blockType in lexical payload.");
        const currentIndex = lexicalIndex;
        lexicalIndex += 1;
        blocks.push({
          blockType: "unknown",
          fields: rawFields,
          lexicalKey,
          lexicalIndex: currentIndex,
          warnings: blockWarnings,
          supported: false
        });
      } else if (!MARKETING_BLOCK_TYPES.has(blockType)) {
        if (!unsupportedTypes.has(blockType)) {
          unsupportedTypes.add(blockType);
          appendWarning(`Unsupported marketing block type "${blockType}" will be ignored.`);
        }
        const currentIndex = lexicalIndex;
        lexicalIndex += 1;
        blocks.push({
          blockType,
          fields: rawFields,
          lexicalKey,
          lexicalIndex: currentIndex,
          warnings: blockWarnings,
          supported: false
        });
      } else {
        const currentIndex = lexicalIndex;
        lexicalIndex += 1;
        blocks.push({
          blockType,
          fields: rawFields,
          lexicalKey,
          lexicalIndex: currentIndex,
          warnings: blockWarnings,
          supported: true
        });
      }
    }

    if (Array.isArray(lexicalNode.children)) {
      for (const child of lexicalNode.children) {
        pending.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return blocks;
};

const hasValidMetric = (value: unknown): boolean => {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return !!(toStringOrUndefined(record.label) && toStringOrUndefined(record.value));
  });
};

export type NormalizeLexicalOptions = {
  sectionLabel?: string;
  maxDepth?: number;
  logger?: (message: string) => void;
};

export type NormalizeLexicalResult = {
  blocks: NormalizedLexicalBlock[];
  warnings: string[];
};

export const normalizeMarketingLexicalContent = (
  value: unknown,
  options: NormalizeLexicalOptions = {}
): NormalizeLexicalResult => {
  const warnings: string[] = [];
  const contextLabel = options.sectionLabel ? `section "${options.sectionLabel}"` : "section";
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const emitWarning: WarnFn = (message) => {
    const formatted = `[cms] ${message}`;
    warnings.push(formatted);
    if (typeof options.logger === "function") {
      options.logger(formatted);
    }
    return formatted;
  };

  if (!isLexicalEditorState(value)) {
    emitWarning(`Lexical content for ${contextLabel} is not a valid editor state.`);
    return { blocks: [], warnings };
  }

  const supportedBlocks = collectSupportedBlocks(value, emitWarning, maxDepth);
  const normalizedBlocks: NormalizedLexicalBlock[] = [];

  for (const block of supportedBlocks) {
    const trace: NormalizeLexicalBlockTrace = {
      blockType: block.blockType,
      lexicalIndex: block.lexicalIndex,
      lexicalKey: block.lexicalKey,
      sectionLabel: options.sectionLabel,
      provenance: options.sectionLabel?.toLowerCase().includes("fixture") ? "fixture" : "payload",
      operations: [],
      warnings: [...block.warnings],
      normalized: false
    };

    if (!block.supported) {
      trace.skipReason =
        trace.warnings.at(-1) ??
        `Lexical block "${block.blockType}" in ${contextLabel} was not supported by the normalizer.`;
      normalizedBlocks.push({ node: null, trace });
      continue;
    }

    const captureWarning: WarnFn = (message) => {
      const formatted = emitWarning(message);
      if (!trace.warnings.includes(formatted)) {
        trace.warnings.push(formatted);
      }
      return formatted;
    };

    const hydratedFields = toHydratedFields(block.fields, captureWarning);

    if (block.blockType === "marketing-testimonial") {
      if (!toStringOrUndefined(hydratedFields.quote) && hydratedFields.testimonial) {
        const referenced = hydratedFields.testimonial;
        if (referenced && typeof referenced === "object") {
          const record = referenced as Record<string, unknown>;
          const referencedQuote = toStringOrUndefined(record.quote);
          if (referencedQuote) {
            hydratedFields.quote = referencedQuote;
            trace.operations.push("hydrated testimonial quote from referenced document");
          }
          if (!toStringOrUndefined(hydratedFields.author)) {
            hydratedFields.author = toStringOrUndefined(record.author);
            trace.operations.push("hydrated testimonial author from referenced document");
          }
          if (!toStringOrUndefined(hydratedFields.role)) {
            hydratedFields.role = toStringOrUndefined(record.role);
            trace.operations.push("hydrated testimonial role from referenced document");
          }
          if (!toStringOrUndefined(hydratedFields.company)) {
            hydratedFields.company = toStringOrUndefined(record.company);
            trace.operations.push("hydrated testimonial company from referenced document");
          }
        } else {
          trace.skipReason = `Testimonial relationship in ${contextLabel} did not provide a populated document.`;
          captureWarning(trace.skipReason);
          normalizedBlocks.push({ node: null, trace });
          continue;
        }
      }

      const quote = toStringOrUndefined(hydratedFields.quote);
      if (!quote) {
        trace.skipReason = `Testimonial block in ${contextLabel} is missing a quote and was skipped.`;
        captureWarning(trace.skipReason);
        normalizedBlocks.push({ node: null, trace });
        continue;
      }
    }

    if (block.blockType === "marketing-metrics" && !hasValidMetric(hydratedFields.metrics)) {
      trace.operations.push("metrics fallback recommended due to invalid metric entries");
      captureWarning(`Metrics block in ${contextLabel} does not include any valid metric entries.`);
    }

    const content = createMarketingContentFromBlock(block.blockType, hydratedFields);
    if (!content) {
      trace.skipReason = `Marketing block "${block.blockType}" in ${contextLabel} could not be normalized and was skipped.`;
      captureWarning(trace.skipReason);
      normalizedBlocks.push({ node: null, trace });
      continue;
    }

    trace.normalized = true;
    normalizedBlocks.push({ node: content, trace });
  }

  return { blocks: normalizedBlocks, warnings };
};
