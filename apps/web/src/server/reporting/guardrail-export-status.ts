import "server-only";

export type GuardrailExportStatus = {
  cursor: string | null;
  rows: number | null;
  updatedAt: string | null;
  downloadUrl: string | null;
  workflowUrl: string | null;
};

type GuardrailExportStatusPayload = {
  cursor?: string | null;
  rows?: number | null;
  updatedAt?: string | null;
  downloadUrl?: string | null;
  workflowUrl?: string | null;
};

const statusUrl = process.env.GUARDRAIL_EXPORT_STATUS_URL ?? null;
const defaultWorkflowUrl =
  process.env.GUARDRAIL_EXPORT_WORKFLOW_URL ??
  "https://github.com/smplat/smplat/actions/workflows/guardrail-followup-export.yml";

const coerceString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
};

function normalizePayload(payload: GuardrailExportStatusPayload | null): GuardrailExportStatus | null {
  if (!payload) {
    return null;
  }
  const cursor = coerceString(payload.cursor);
  const rows = coerceNumber(payload.rows);
  const updatedAt = coerceString(payload.updatedAt);
  const downloadUrl = coerceString(payload.downloadUrl);
  const workflowUrl = coerceString(payload.workflowUrl) ?? defaultWorkflowUrl;

  if (!cursor && !updatedAt && !downloadUrl) {
    return null;
  }

  return {
    cursor,
    rows,
    updatedAt,
    downloadUrl,
    workflowUrl,
  };
}

export async function fetchGuardrailExportStatus(): Promise<GuardrailExportStatus | null> {
  if (!statusUrl) {
    return null;
  }
  try {
    const response = await fetch(statusUrl, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Status request failed (${response.status})`);
    }
    const payload = (await response.json()) as GuardrailExportStatusPayload;
    return normalizePayload(payload);
  } catch (error) {
    console.warn("Unable to read guardrail export status", error);
    return null;
  }
}

