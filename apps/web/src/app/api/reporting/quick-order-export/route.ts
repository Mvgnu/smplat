import { NextResponse } from "next/server";

import { fetchQuickOrderExportStatus } from "@/server/reporting/quick-order-export-status";

const NDJSON_MIME = "application/x-ndjson";
const DEFAULT_FILENAME = "quick-order-export.ndjson";

export async function GET() {
  try {
    const status = await fetchQuickOrderExportStatus();
    if (!status?.downloadUrl) {
      return NextResponse.json(
        { error: "Quick-order export download is unavailable. Confirm the status endpoint is configured." },
        { status: 503 },
      );
    }

    const upstream = await fetch(status.downloadUrl, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      const details = await upstream.text().catch(() => "");
      console.error("Quick-order export download failed", upstream.status, details);
      return NextResponse.json({ error: "Unable to download quick-order export" }, { status: 502 });
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") ?? NDJSON_MIME);
    headers.set("Cache-Control", "no-store");
    const fallbackFile =
      status.syncedAt?.replace(/[:.]/g, "-") ?? new Date().toISOString().replace(/[:.]/g, "-");
    const filename =
      upstream.headers.get("content-disposition")?.match(/filename=\"?(.+?)\"?$/)?.[1] ??
      `${fallbackFile || "quick-order"}-${DEFAULT_FILENAME}`;
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Quick-order export proxy error", error);
    return NextResponse.json({ error: "Unable to proxy quick-order export" }, { status: 500 });
  }
}

