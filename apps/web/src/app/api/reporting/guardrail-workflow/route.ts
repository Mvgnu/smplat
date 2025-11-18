import { NextResponse } from "next/server";

import { fetchGuardrailWorkflowTelemetrySummary } from "@/server/reporting/guardrail-workflow-telemetry";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? Number(limitParam) : null;
  const limit = parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined;

  try {
    const summary = await fetchGuardrailWorkflowTelemetrySummary(limit);
    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error("Failed to fetch guardrail workflow telemetry summary", error);
    return NextResponse.json({ error: "Unable to load guardrail workflow telemetry summary" }, { status: 500 });
  }
}
