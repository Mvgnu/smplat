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
};

type WarnFn = (message: string) => void;

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
      if (!fields || typeof fields !== "object") {
        warn("Encountered block node without fields in lexical payload.");
      } else {
        const blockType = toStringOrUndefined((fields as Record<string, unknown>).blockType);
        if (!blockType) {
          warn("Encountered block node without a blockType in lexical payload.");
        } else if (!MARKETING_BLOCK_TYPES.has(blockType)) {
          if (!unsupportedTypes.has(blockType)) {
            unsupportedTypes.add(blockType);
            warn(`Unsupported marketing block type "${blockType}" will be ignored.`);
          }
        } else {
          blocks.push({
            blockType,
            fields: fields as Record<string, unknown>
          });
        }
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
  nodes: MarketingContent[];
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
  };

  if (!isLexicalEditorState(value)) {
    emitWarning(`Lexical content for ${contextLabel} is not a valid editor state.`);
    return { nodes: [], warnings };
  }

  const supportedBlocks = collectSupportedBlocks(value, emitWarning, maxDepth);
  const nodes: MarketingContent[] = [];

  for (const block of supportedBlocks) {
    const hydratedFields = toHydratedFields(block.fields, emitWarning);

    if (block.blockType === "marketing-testimonial") {
      if (!toStringOrUndefined(hydratedFields.quote) && hydratedFields.testimonial) {
        const referenced = hydratedFields.testimonial;
        if (referenced && typeof referenced === "object") {
          const record = referenced as Record<string, unknown>;
          const referencedQuote = toStringOrUndefined(record.quote);
          if (referencedQuote) {
            hydratedFields.quote = referencedQuote;
          }
          if (!toStringOrUndefined(hydratedFields.author)) {
            hydratedFields.author = toStringOrUndefined(record.author);
          }
          if (!toStringOrUndefined(hydratedFields.role)) {
            hydratedFields.role = toStringOrUndefined(record.role);
          }
          if (!toStringOrUndefined(hydratedFields.company)) {
            hydratedFields.company = toStringOrUndefined(record.company);
          }
        } else {
          emitWarning(`Testimonial relationship in ${contextLabel} did not provide a populated document.`);
        }
      }

      const quote = toStringOrUndefined(hydratedFields.quote);
      if (!quote) {
        emitWarning(`Testimonial block in ${contextLabel} is missing a quote and was skipped.`);
        continue;
      }
    }

    if (block.blockType === "marketing-metrics" && !hasValidMetric(hydratedFields.metrics)) {
      emitWarning(`Metrics block in ${contextLabel} does not include any valid metric entries.`);
    }

    const content = createMarketingContentFromBlock(block.blockType, hydratedFields);
    if (!content) {
      emitWarning(`Marketing block "${block.blockType}" in ${contextLabel} could not be normalized and was skipped.`);
      continue;
    }

    nodes.push(content);
  }

  return { nodes, warnings };
};
