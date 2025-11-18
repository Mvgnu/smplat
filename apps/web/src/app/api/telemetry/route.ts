import { NextResponse } from "next/server";

import { appendQuickOrderEvents } from "@/server/telemetry/quick-order-storage";
import { appendGuardrailWorkflowEvents } from "@/server/telemetry/guardrail-workflow-storage";
import type {
  QuickOrderAbortTelemetryEvent,
  QuickOrderCompleteTelemetryEvent,
  QuickOrderStartTelemetryEvent,
  GuardrailWorkflowTelemetryEvent,
} from "@/types/reporting";

const telemetryEndpoint = process.env.TELEMETRY_ENDPOINT ?? null;

function isPayload(value: unknown): value is Record<string, unknown> | Array<unknown> {
  if (!value) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return typeof value === "object";
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!isPayload(body)) {
      return NextResponse.json({ error: "Missing telemetry payload" }, { status: 400 });
    }

    await recordTelemetrySnapshots(body);

    if (!telemetryEndpoint) {
      console.warn("TELEMETRY_ENDPOINT is not configured; telemetry proxy skipping dispatch");
      return NextResponse.json({ skipped: true }, { status: 202 });
    }

    const response = await fetch(telemetryEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error("Telemetry proxy dispatch failed", response.status, text);
      return NextResponse.json({ error: "Telemetry upstream rejected payload" }, { status: 502 });
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    console.error("Telemetry proxy error", error);
    return NextResponse.json({ error: "Unable to dispatch telemetry" }, { status: 500 });
  }
}

type QuickOrderTelemetryCapture =
  | QuickOrderStartTelemetryEvent
  | QuickOrderAbortTelemetryEvent
  | QuickOrderCompleteTelemetryEvent;

async function recordTelemetrySnapshots(payload: unknown): Promise<void> {
  await Promise.all([recordQuickOrderSnapshot(payload), recordGuardrailWorkflowSnapshot(payload)]);
}

function extractQuickOrderEvents(payload: unknown): QuickOrderTelemetryCapture[] {
  if (!payload) {
    return [];
  }
  const items = Array.isArray(payload) ? payload : [payload];
  const quickOrderEvents: QuickOrderTelemetryCapture[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const name = record.name;
    if (
      name === "quick_order.start" ||
      name === "quick_order.abort" ||
      name === "quick_order.complete"
    ) {
      quickOrderEvents.push(record as QuickOrderTelemetryCapture);
    }
  }
  return quickOrderEvents;
}

type GuardrailWorkflowCapture = GuardrailWorkflowTelemetryEvent;

async function recordGuardrailWorkflowSnapshot(payload: unknown): Promise<void> {
  const events = extractGuardrailWorkflowEvents(payload);
  if (!events.length) {
    return;
  }
  try {
    await appendGuardrailWorkflowEvents(events);
  } catch (error) {
    console.warn("Unable to persist guardrail workflow telemetry snapshot", error);
  }
}

function extractGuardrailWorkflowEvents(payload: unknown): GuardrailWorkflowCapture[] {
  if (!payload) {
    return [];
  }
  const items = Array.isArray(payload) ? payload : [payload];
  const workflowEvents: GuardrailWorkflowCapture[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (record.name === "guardrail.workflow") {
      workflowEvents.push(record as GuardrailWorkflowCapture);
    }
  }
  return workflowEvents;
}
