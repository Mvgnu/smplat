import { NextResponse } from "next/server";

import { appendQuickOrderEvents } from "@/server/telemetry/quick-order-storage";
import type {
  QuickOrderAbortTelemetryEvent,
  QuickOrderCompleteTelemetryEvent,
  QuickOrderStartTelemetryEvent,
} from "@/types/reporting";

type QuickOrderTelemetryEvent =
  | QuickOrderStartTelemetryEvent
  | QuickOrderAbortTelemetryEvent
  | QuickOrderCompleteTelemetryEvent;

const QUICK_ORDER_EVENT_NAMES = new Set<QuickOrderTelemetryEvent["name"]>([
  "quick_order.start",
  "quick_order.abort",
  "quick_order.complete",
]);

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    const events = normalizePayload(payload);
    if (!events.length) {
      return NextResponse.json({ error: "No quick-order events provided." }, { status: 400 });
    }
    await appendQuickOrderEvents(events);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Failed to capture quick-order telemetry", error);
    return NextResponse.json({ error: "Unable to capture quick-order telemetry" }, { status: 500 });
  }
}

function normalizePayload(payload: unknown): QuickOrderTelemetryEvent[] {
  if (!payload) {
    return [];
  }
  const items = Array.isArray(payload) ? payload : [payload];
  const events: QuickOrderTelemetryEvent[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (!QUICK_ORDER_EVENT_NAMES.has(record.name as QuickOrderTelemetryEvent["name"])) {
      continue;
    }
    const recordedAt = typeof record.recordedAt === "string" ? record.recordedAt : new Date().toISOString();
    events.push({
      ...(record as QuickOrderTelemetryEvent),
      recordedAt,
    });
  }
  return events;
}
