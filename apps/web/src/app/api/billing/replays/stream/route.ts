import { NextResponse } from "next/server";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

const checkoutApiKey = process.env.CHECKOUT_API_KEY ?? "";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!checkoutApiKey) {
    return new NextResponse("Replay console disabled.", { status: 503 });
  }

  const upstreamUrl = new URL(`${apiBaseUrl}/api/v1/billing/replays/stream`);
  const { searchParams } = new URL(request.url);
  searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      "X-API-Key": checkoutApiKey,
      Accept: "text/event-stream",
    },
    cache: "no-store",
  });

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const status = upstreamResponse.status || 502;
    const message = await upstreamResponse.text().catch(() => "Unable to open replay stream.");
    return new NextResponse(message || "Unable to open replay stream.", { status });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = upstreamResponse.body!.getReader();
      const forward = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            if (value) {
              controller.enqueue(value);
            }
            forward();
          })
          .catch((error) => controller.error(error));
      };
      forward();
    },
    cancel() {
      upstreamResponse.body?.cancel().catch(() => undefined);
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
