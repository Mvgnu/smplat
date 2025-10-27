import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MarketingSections,
  defaultMarketingMetricsFallback
} from "@/components/marketing/sections";
import { normalizeMarketingLexicalContent } from "@/server/cms/lexical";
import {
  type MarketingContentDocument,
  type PageDocument
} from "@/server/cms/types";
import {
  validateMarketingBlock,
  type MarketingBlockValidationResult
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
  hero?: PageDocument["hero"];
  metrics?: PageDocument["content"][number]["metrics"];
  validation: {
    ok: boolean;
    warnings: string[];
    blocks: Array<{
      key?: string;
      kind?: string;
      valid: boolean;
      errors: string[];
      warnings: string[];
    }>;
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
  warnings: string[]
): PageDocument["content"][number] | null => {
  const state = input.content;
  const label = toNonEmptyString(input.heading) ?? `section-${index + 1}`;

  const { nodes, warnings: lexicalWarnings } = normalizeMarketingLexicalContent(state, {
    sectionLabel: label
  });

  warnings.push(...lexicalWarnings);

  if (!nodes.length) {
    return null;
  }

  for (const block of nodes as MarketingContentDocument[]) {
    validations.push(validateMarketingBlock(block));
  }

  return {
    _type: "section",
    _key: toNonEmptyString(input.id) ?? label,
    heading: toNonEmptyString(input.heading),
    subheading: toNonEmptyString(input.subheading),
    layout: undefined,
    content: state,
    marketingContent: nodes,
    metrics: undefined,
    faqItems: undefined,
    testimonials: undefined,
    caseStudy: undefined,
    pricingTiers: undefined,
    blogPosts: undefined
  } as PageDocument["content"][number];
};

const renderMarkup = (sections: PageDocument["content"]): string => {
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

const resolveMetricsSummary = (sections: PageDocument["content"]):
  | PageDocument["content"][number]["metrics"]
  | undefined => {
  for (const section of sections) {
    if (section._type !== "section") continue;
    if (!Array.isArray(section.marketingContent)) continue;

    for (const block of section.marketingContent) {
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
            (metricsBlock as { subheading?: string }).subheading,
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
  warnings: string[]
): LivePreviewBroadcast["validation"] => {
  const blocks = validations.map((validation) => ({
    key: validation.key,
    kind: validation.kind,
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings
  }));

  const ok = blocks.every((block) => block.valid) && warnings.length === 0;

  return {
    ok,
    warnings,
    blocks
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
  const sections: PageDocument["content"] = [];

  lexicalSections.forEach((section, index) => {
    const rendered = toSectionFromLexical(section, index, validations, normalizationWarnings);
    if (rendered) {
      sections.push(rendered);
    }
  });

  if (sections.length === 0) {
    return NextResponse.json({ error: "No lexical sections to render" }, { status: 422 });
  }

  const markup = renderMarkup(sections);
  const validationSummary = summarizeValidation(validations, normalizationWarnings);
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
    hero: body.hero ?? undefined,
    metrics: resolveMetricsSummary(sections),
    validation: validationSummary
  };

  await broadcast(broadcastPayload);

  return NextResponse.json({ acknowledged: true, validation: validationSummary });
}
