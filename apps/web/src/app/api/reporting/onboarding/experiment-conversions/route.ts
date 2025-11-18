import { NextResponse } from "next/server";

import { fetchExperimentConversionSnapshot } from "@/server/reporting/experiment-conversion-snapshot";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor");
  const limit = limitParam ? Math.min(Number(limitParam) || 0, 25) : undefined;

  try {
    const snapshot = await fetchExperimentConversionSnapshot({
      limit,
      cursor
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("experiment-conversions proxy failed", error);
    return NextResponse.json(
      {
        metrics: [],
        nextCursor: null,
        error: "Unable to load conversions"
      },
      { status: 502 }
    );
  }
}
