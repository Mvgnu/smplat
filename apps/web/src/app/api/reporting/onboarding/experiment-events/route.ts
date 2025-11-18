import { NextResponse } from "next/server";

import { requireRole } from "@/server/auth/policies";
import { fetchOnboardingExperimentEvents } from "@/server/reporting/onboarding-experiment-events";

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 250;

function sanitizeLimit(value: string | null): number {
  if (!value) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = sanitizeLimit(url.searchParams.get("limit"));
  const cursor = url.searchParams.get("cursor");

  try {
    await requireRole("operator", {
      context: {
        route: "api.reporting.onboarding.experiment-events",
        method: "GET"
      }
    });
  } catch (error) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const response = await fetchOnboardingExperimentEvents({
    limit,
    cursor: cursor && cursor.length > 0 ? cursor : null
  });

  return NextResponse.json(response, {
    status: 200,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
