import "server-only";

import { promises as fs } from "fs";
import path from "path";

import type {
  QuickOrderAbortTelemetryEvent,
  QuickOrderCompleteTelemetryEvent,
  QuickOrderStartTelemetryEvent,
} from "@/types/reporting";

type QuickOrderTelemetryEvent =
  | QuickOrderStartTelemetryEvent
  | QuickOrderAbortTelemetryEvent
  | QuickOrderCompleteTelemetryEvent;

const STORAGE_DIR = path.join(process.cwd(), ".telemetry");
const QUICK_ORDER_FILE = path.join(STORAGE_DIR, "quick-order-events.ndjson");
const MAX_RECENT_EVENTS = 2000;
const MAX_STORED_EVENTS = 5000;

export function getQuickOrderEventFilePath(): string {
  return QUICK_ORDER_FILE;
}

export async function appendQuickOrderEvents(events: QuickOrderTelemetryEvent[]): Promise<void> {
  if (!events.length) {
    return;
  }
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const payload = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await fs.appendFile(QUICK_ORDER_FILE, payload, "utf8");
  await enforceRetention();
}

export async function readQuickOrderEvents(): Promise<QuickOrderTelemetryEvent[]> {
  const lines = await readQuickOrderEventLines({ limit: MAX_RECENT_EVENTS });
  const events: QuickOrderTelemetryEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as QuickOrderTelemetryEvent;
      if (parsed?.name && parsed.name.startsWith("quick_order.")) {
        events.push(parsed);
      }
    } catch {
      // Ignore malformed lines
    }
  }
  return events;
}

export async function readQuickOrderEventLines(options?: { limit?: number }): Promise<string[]> {
  try {
    const buffer = await fs.readFile(QUICK_ORDER_FILE, "utf8");
    const lines = buffer.split("\n").filter((line) => line.trim().length > 0);
    if (!lines.length) {
      return [];
    }
    const limit = options?.limit;
    const boundedLimit =
      typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_STORED_EVENTS) : null;
    return boundedLimit ? lines.slice(-boundedLimit) : lines;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function enforceRetention(): Promise<void> {
  try {
    const buffer = await fs.readFile(QUICK_ORDER_FILE, "utf8");
    const lines = buffer.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length <= MAX_STORED_EVENTS) {
      return;
    }
    const trimmed = lines.slice(-MAX_STORED_EVENTS).join("\n") + "\n";
    await fs.writeFile(QUICK_ORDER_FILE, trimmed, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    console.warn("Failed to enforce quick-order telemetry retention", error);
  }
}
