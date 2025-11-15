"use server";

import { NextResponse } from "next/server";

import { recordPricingExperimentEvent } from "@/server/catalog/pricing-experiments";

type IncomingEvent = {
  slug: unknown;
  variantKey: unknown;
  exposures?: unknown;
  conversions?: unknown;
  revenueCents?: unknown;
};

type NormalizedEvent = {
  slug: string;
  variantKey: string;
  exposures?: number;
  conversions?: number;
  revenueCents?: number;
};

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeEvent(event: IncomingEvent): NormalizedEvent | null {
  const slug = typeof event.slug === "string" ? event.slug.trim() : "";
  const variantKey = typeof event.variantKey === "string" ? event.variantKey.trim() : "";
  if (!slug || !variantKey) {
    return null;
  }

  const normalized: NormalizedEvent = {
    slug,
    variantKey,
  };

  const exposures = coerceNumber(event.exposures);
  const conversions = coerceNumber(event.conversions);
  const revenueCents = coerceNumber(event.revenueCents);

  if (typeof exposures === "number") {
    normalized.exposures = exposures;
  }
  if (typeof conversions === "number") {
    normalized.conversions = conversions;
  }
  if (typeof revenueCents === "number") {
    normalized.revenueCents = revenueCents;
  }

  return normalized;
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawEvents = Array.isArray((payload as { events?: IncomingEvent[] } | null)?.events)
    ? (payload as { events?: IncomingEvent[] }).events ?? []
    : [];
  const normalizedEvents = rawEvents
    .map((event) => normalizeEvent(event))
    .filter((event): event is NormalizedEvent => Boolean(event));

  if (normalizedEvents.length === 0) {
    return NextResponse.json({ recorded: 0 });
  }

  try {
    await Promise.all(
      normalizedEvents.map((event) =>
        recordPricingExperimentEvent(event.slug, {
          variantKey: event.variantKey,
          exposures: event.exposures,
          conversions: event.conversions,
          revenueCents: event.revenueCents,
        }),
      ),
    );
  } catch (error) {
    console.error("Failed to record pricing experiment events", error);
    return NextResponse.json({ error: "Failed to record pricing experiment events" }, { status: 500 });
  }

  return NextResponse.json({ recorded: normalizedEvents.length });
}
