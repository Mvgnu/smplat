import { NextResponse } from "next/server";

import { fetchOnboardingJourney } from "@/server/onboarding/journeys";

export async function GET(
  _request: Request,
  { params }: { params: { orderId: string } }
) {
  try {
    const journey = await fetchOnboardingJourney(params.orderId);
    if (!journey) {
      return NextResponse.json({ error: "Journey not found" }, { status: 404 });
    }

    return NextResponse.json(journey);
  } catch (error) {
    console.warn("Failed to fetch onboarding journey", error);
    return NextResponse.json({ error: "Failed to fetch journey" }, { status: 500 });
  }
}
