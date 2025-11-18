import "server-only";

import { promises as fs } from "fs";
import path from "path";

import type { GuardrailWorkflowTelemetryEvent } from "@/types/reporting";

const STORAGE_DIR = path.join(process.cwd(), ".telemetry");
const WORKFLOW_FILE = path.join(STORAGE_DIR, "guardrail-workflow-events.ndjson");
const MAX_RECENT_EVENTS = 2000;

export function getGuardrailWorkflowFilePath(): string {
  return WORKFLOW_FILE;
}

export async function appendGuardrailWorkflowEvents(events: GuardrailWorkflowTelemetryEvent[]): Promise<void> {
  if (!events.length) {
    return;
  }
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const payload = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await fs.appendFile(WORKFLOW_FILE, payload, "utf8");
  await enforceRetention();
}

export async function readGuardrailWorkflowEvents(limit = MAX_RECENT_EVENTS): Promise<GuardrailWorkflowTelemetryEvent[]> {
  try {
    const buffer = await fs.readFile(WORKFLOW_FILE, "utf8");
    const lines = buffer.split("\n").filter((line) => line.trim().length > 0);
    if (!lines.length) {
      return [];
    }
    const boundedLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_RECENT_EVENTS) : MAX_RECENT_EVENTS;
    const slice = lines.slice(-boundedLimit);
    const events: GuardrailWorkflowTelemetryEvent[] = [];
    for (const line of slice) {
      try {
        const parsed = JSON.parse(line) as GuardrailWorkflowTelemetryEvent;
        if (parsed?.name === "guardrail.workflow") {
          events.push(parsed);
        }
      } catch {
        // ignore malformed line
      }
    }
    return events;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function enforceRetention(): Promise<void> {
  try {
    const buffer = await fs.readFile(WORKFLOW_FILE, "utf8");
    const lines = buffer.split("\n").filter((line) => line.trim().length > 0);
    if (lines.length <= MAX_RECENT_EVENTS) {
      return;
    }
    const trimmed = lines.slice(-MAX_RECENT_EVENTS).join("\n") + "\n";
    await fs.writeFile(WORKFLOW_FILE, trimmed, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    console.warn("Failed to enforce guardrail workflow telemetry retention", error);
  }
}
