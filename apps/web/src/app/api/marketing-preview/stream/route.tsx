import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MarketingSections,
  defaultMarketingMetricsFallback
} from "@/components/marketing/sections";
import type { SnapshotMetrics } from "@/server/cms/preview/types";
import { normalizeMarketingLexicalContent } from "@/server/cms/lexical";
import { recordLivePreviewDelta } from "@/server/cms/history";
import {
  type MarketingContentDocument,
  type PageDocument
} from "@/server/cms/types";
import {
  validateMarketingBlock,
  type MarketingBlockValidationResult,
  type MarketingBlockRecoveryHint
} from "@/server/cms/validation";

// meta: route: api/marketing-preview/stream
// meta: feature: marketing-preview-live

type LivePreviewClient = {
  id: string;
  send: (payload: string) => void;
  close: () => void;
};

type LivePreviewSectionInput = {
  id?: string | null;
  heading?: string | null;
  subheading?: string | null;
  content?: unknown;
};

type PageSections = NonNullable<PageDocument["content"]>;
type PageSection = PageSections[number];
type MarketingSection = Extract<PageSection, { _type: "section" }>;

type SectionDiagnostics = {
  label: string;
  index: number;
  warnings: string[];
  blocks: MarketingBlockValidationResult[];
};

type LivePreviewPayload = {
  requestId?: string;
  collection: string;
  docId?: string | null;
  slug?: string | null;
  route?: string | null;
  label?: string | null;
  environment?: string | null;
  updatedAt?: string | null;
  title?: string | null;
  hero?: PageDocument["hero"] | null;
  lexical?: LivePreviewSectionInput[];
  variant?: {
    persona?: string | null;
    campaign?: string | null;
    featureFlag?: string | null;
    id?: string | null;
    label?: string | null;
  } | null;
};

type LivePreviewVariant = {
  key: string;
  persona?: string | null;
  campaign?: string | null;
  featureFlag?: string | null;
  label: string;
};

type LivePreviewBroadcast = {
  type: "marketing-preview-delta";
  route: string;
  slug?: string | null;
  label?: string | null;
  environment?: string | null;
  generatedAt: string;
  requestId?: string;
  collection: string;
  docId?: string | null;
  markup: string;
  blockKinds: string[];
  sectionCount: number;
  variant: LivePreviewVariant;
  hero?: PageDocument["hero"];
  metrics?: SnapshotMetrics;
  validation: {
    ok: boolean;
    warnings: string[];
    blocks: Array<{
      key?: string;
      kind?: string;
      valid: boolean;
      errors: string[];
      warnings: string[];
      fingerprint?: string;
      recoveryHints: MarketingBlockRecoveryHint[];
      fallback?: MarketingBlockValidationResult["fallback"];
      trace: MarketingBlockValidationResult["trace"];
    }>;
  };
  diagnostics: {
    summary: {
      totalBlocks: number;
      invalidBlocks: number;
      warningBlocks: number;
    };
    sections: Array<{
      label: string;
      index: number;
      warnings: string[];
      blockCount: number;
      invalidBlocks: number;
    }>;
    blocks: Array<{
      key?: string;
      kind?: string;
      valid: boolean;
      errors: string[];
      warnings: string[];
      fingerprint?: string;
      recoveryHints: MarketingBlockRecoveryHint[];
      fallback?: MarketingBlockValidationResult["fallback"];
      trace: MarketingBlockValidationResult["trace"];
    }>;
    normalizationWarnings: string[];
  };
};

const encoder = new TextEncoder();
const clients = new Map<string, LivePreviewClient>();
const LIVE_PREVIEW_SECRET = process.env.PAYLOAD_LIVE_PREVIEW_SECRET;

const toNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return undefined;
};

const toVariantDescriptor = (payload: LivePreviewPayload): LivePreviewVariant => {
  const persona = toNonEmptyString(payload.variant?.persona) ?? null;
  const campaign = toNonEmptyString(payload.variant?.campaign) ?? null;
  const featureFlag = toNonEmptyString(payload.variant?.featureFlag) ?? null;
  const id = toNonEmptyString(payload.variant?.id);
  const label =
    payload.variant?.label ??
    (([persona ?? "Baseline", campaign ?? null, featureFlag ?? null]
      .filter((segment) => segment && segment !== "Baseline")
      .join(" · ")) ||
      "Baseline");
  const keySeed = [persona ?? "base", campaign ?? "default", featureFlag ?? "flag", id ?? ""].join(":");
  let hash = 5381;
  for (let index = 0; index < keySeed.length; index += 1) {
    hash = (hash * 33) ^ keySeed.charCodeAt(index);
  }
  const key = `variant-${(hash >>> 0).toString(16)}`;
  return {
    key,
    persona,
    campaign,
    featureFlag,
    label
  };
};

const resolveRoute = (payload: LivePreviewPayload): string | null => {
  const explicit = toNonEmptyString(payload.route);
  if (explicit) {
    return explicit;
  }

  const slug = toNonEmptyString(payload.slug);
  if (!slug) {
    return null;
  }

  if (slug === "home" || slug === "homepage" || slug === "/") {
    return "/";
  }

  return slug.startsWith("/") ? slug : `/${slug}`;
};

const toSectionFromLexical = (
  input: LivePreviewSectionInput,
  index: number,
  validations: MarketingBlockValidationResult[],
  warnings: string[],
  sectionDiagnostics: SectionDiagnostics[]
): PageSection | null => {
  const state = input.content;
  const label = toNonEmptyString(input.heading) ?? `section-${index + 1}`;

  const { blocks, warnings: lexicalWarnings } = normalizeMarketingLexicalContent(state, {
    sectionLabel: label
  });

  warnings.push(...lexicalWarnings);

  const sectionResults: MarketingBlockValidationResult[] = [];
  const marketingContent: MarketingContentDocument[] = [];

  for (const normalized of blocks) {
    const validation = validateMarketingBlock(
      (normalized.node as MarketingContentDocument) ?? null,
      normalized.trace
    );
    validations.push(validation);
    sectionResults.push(validation);
    if (validation.block) {
      marketingContent.push(validation.block);
    }
  }

  sectionDiagnostics.push({
    label,
    index,
    warnings: lexicalWarnings,
    blocks: sectionResults
  });

  if (!marketingContent.length) {
    return null;
  }

  return {
    _type: "section",
    _key: toNonEmptyString(input.id) ?? label,
    heading: toNonEmptyString(input.heading),
    subheading: toNonEmptyString(input.subheading),
    layout: undefined,
    content: state,
    marketingContent,
    metrics: undefined,
    faqItems: undefined,
    testimonials: undefined,
    caseStudy: undefined,
    pricingTiers: undefined,
    blogPosts: undefined
  } as PageSection;
};

const renderMarkup = (sections: PageSections): string => {
  if (!sections.length) {
    return "";
  }

  return renderToStaticMarkup(
    <MarketingSections
      sections={sections}
      metricFallback={defaultMarketingMetricsFallback}
      sectionContentClassName="lexical"
    />
  );
};

const resolveMetricsSummary = (sections: PageSections): SnapshotMetrics | undefined => {
  for (const section of sections) {
    if (section._type !== "section") continue;
    const marketingSection = section as MarketingSection;
    if (!Array.isArray(marketingSection.marketingContent)) continue;

    for (const block of marketingSection.marketingContent) {
      if ((block as MarketingContentDocument).kind === "metrics") {
        const metricsBlock = block as MarketingContentDocument & { metrics?: unknown };
        const values = Array.isArray(metricsBlock.metrics)
          ? metricsBlock.metrics.map((item) => ({
              label: (item as { label?: string }).label,
              value: (item as { value?: string }).value
            }))
          : [];
        return {
          label:
            (metricsBlock as { heading?: string }).heading ??
            (metricsBlock as { subheading?: string }).subheading ??
            undefined,
          values
        };
      }
    }
  }

  return undefined;
};

const broadcast = (payload: LivePreviewBroadcast) => {
  if (clients.size === 0) {
    return;
  }

  const data = `event: marketing-preview\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of Array.from(clients.values())) {
    try {
      client.send(data);
    } catch {
      client.close();
      clients.delete(client.id);
    }
  }
};

export function GET() {
  let clientId = "";
  let keepAlive: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      clientId = randomUUID();
      const send = (payload: string) => {
        controller.enqueue(encoder.encode(payload));
      };

      keepAlive = setInterval(() => {
        try {
          send(`:keep-alive\n\n`);
        } catch {
          if (keepAlive) {
            clearInterval(keepAlive);
            keepAlive = null;
          }
          clients.delete(clientId);
        }
      }, 15000);

      const close = () => {
        if (keepAlive) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
        clients.delete(clientId);
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      };

      clients.set(clientId, { id: clientId, send, close });
      send(`event: ready\ndata: ${JSON.stringify({ clientId })}\n\n`);
    },
    cancel() {
      if (keepAlive) {
        clearInterval(keepAlive);
        keepAlive = null;
      }
      clients.delete(clientId);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

const authenticate = (request: Request) => {
  if (!LIVE_PREVIEW_SECRET) {
    return false;
  }

  const signature = request.headers.get("x-preview-signature");
  return signature === LIVE_PREVIEW_SECRET;
};

const summarizeValidation = (
  validations: MarketingBlockValidationResult[],
  warnings: string[],
  sections: SectionDiagnostics[]
): { validation: LivePreviewBroadcast["validation"]; diagnostics: LivePreviewBroadcast["diagnostics"] } => {
  const mappedBlocks = validations.map((validation) => ({
    key: validation.key ?? validation.trace.lexicalKey,
    kind: validation.kind ?? validation.trace.blockType,
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    fingerprint: validation.fingerprint,
    recoveryHints: validation.recoveryHints,
    fallback: validation.fallback,
    trace: validation.trace
  }));

  const ok =
    validations.every((validation) => validation.valid && validation.warnings.length === 0) && warnings.length === 0;

  const diagnosticsSummary = {
    totalBlocks: validations.length,
    invalidBlocks: validations.filter((validation) => !validation.valid).length,
    warningBlocks: validations.filter((validation) => validation.warnings.length > 0).length
  };

  const diagnosticsSections = sections.map((section) => ({
    label: section.label,
    index: section.index,
    warnings: section.warnings,
    blockCount: section.blocks.length,
    invalidBlocks: section.blocks.filter((block) => !block.valid).length
  }));

  return {
    validation: {
      ok,
      warnings,
      blocks: mappedBlocks
    },
    diagnostics: {
      summary: diagnosticsSummary,
      sections: diagnosticsSections,
      blocks: mappedBlocks,
      normalizationWarnings: warnings
    }
  };
};

export async function POST(request: Request) {
  if (!authenticate(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as LivePreviewPayload | null;

  if (!body || typeof body.collection !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const route = resolveRoute(body);
  if (!route) {
    return NextResponse.json({ error: "Unable to resolve route" }, { status: 400 });
  }

  const lexicalSections = Array.isArray(body.lexical) ? body.lexical : [];
  const validations: MarketingBlockValidationResult[] = [];
  const normalizationWarnings: string[] = [];
  const sectionDiagnostics: SectionDiagnostics[] = [];
  const sections: PageSections = [];
  const variant = toVariantDescriptor(body);

  lexicalSections.forEach((section, index) => {
    const rendered = toSectionFromLexical(
      section,
      index,
      validations,
      normalizationWarnings,
      sectionDiagnostics
    );
    if (rendered) {
      sections.push(rendered);
    }
  });

  if (sections.length === 0) {
    return NextResponse.json({ error: "No lexical sections to render" }, { status: 422 });
  }

  const markup = renderMarkup(sections);
  const { validation: validationSummary, diagnostics } = summarizeValidation(
    validations,
    normalizationWarnings,
    sectionDiagnostics
  );
  const blockKinds = Array.from(
    new Set(validations.map((validation) => validation.kind).filter(Boolean))
  ) as string[];

  const broadcastPayload: LivePreviewBroadcast = {
    type: "marketing-preview-delta",
    route,
    slug: body.slug,
    label: body.label ?? body.title,
    environment: body.environment,
    generatedAt: body.updatedAt ?? new Date().toISOString(),
    requestId: body.requestId,
    collection: body.collection,
    docId: body.docId,
    markup,
    blockKinds,
    sectionCount: sections.length,
    variant,
    hero: body.hero ?? undefined,
    metrics: resolveMetricsSummary(sections),
    validation: validationSummary,
    diagnostics
  };

  await broadcast(broadcastPayload);

  try {
    const normalizedBlocks = broadcastPayload.validation.blocks.map((block) =>
      JSON.parse(JSON.stringify(block)) as Record<string, unknown>
    );
    const diagnostics = JSON.parse(
      JSON.stringify(broadcastPayload.diagnostics)
    ) as Record<string, unknown>;

    recordLivePreviewDelta({
      manifestGeneratedAt: broadcastPayload.generatedAt,
      generatedAt: broadcastPayload.generatedAt,
      route: broadcastPayload.route ?? null,
      variantKey: broadcastPayload.variant.key,
      payload: {
        route: broadcastPayload.route ?? null,
        slug: broadcastPayload.slug ?? null,
        label: broadcastPayload.label ?? null,
        environment: broadcastPayload.environment ?? null,
        generatedAt: broadcastPayload.generatedAt,
        markup: broadcastPayload.markup,
        blockKinds: broadcastPayload.blockKinds,
        sectionCount: broadcastPayload.sectionCount,
        variant: {
          key: broadcastPayload.variant.key,
          label: broadcastPayload.variant.label,
          persona: broadcastPayload.variant.persona ?? null,
          campaign: broadcastPayload.variant.campaign ?? null,
          featureFlag: broadcastPayload.variant.featureFlag ?? null
        },
        collection: broadcastPayload.collection ?? null,
        docId: broadcastPayload.docId ?? null,
        metrics: broadcastPayload.metrics ?? null,
        hero: broadcastPayload.hero ?? undefined,
        validation: {
          ok: broadcastPayload.validation.ok,
          warnings: [...broadcastPayload.validation.warnings],
          blocks: normalizedBlocks
        },
        diagnostics
      }
    });
  } catch (error) {
    console.error("Failed to persist live preview delta", error);
  }

  return NextResponse.json({
    acknowledged: true,
    validation: validationSummary,
    diagnostics,
    variant
  });
}
