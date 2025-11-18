import { NextResponse } from "next/server";

import { fetchGuardrailExportStatus } from "@/server/reporting/guardrail-export-status";

const DEFAULT_FILENAME = "guardrail_followups.ndjson";
const NDJSON_MIME = "application/x-ndjson";

export async function GET() {
  try {
    const status = await fetchGuardrailExportStatus();
    if (!status?.downloadUrl) {
      return NextResponse.json(
        { error: "Guardrail export download is unavailable. Check the workflow or status endpoint." },
        { status: 503 },
      );
    }

    const upstream = await fetch(status.downloadUrl, { cache: "no-store" });
    if (!upstream.ok || !upstream.body) {
      const details = await upstream.text().catch(() => "");
      console.error("Guardrail export download failed", upstream.status, details);
      return NextResponse.json({ error: "Unable to download guardrail follow-up export" }, { status: 502 });
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") ?? NDJSON_MIME);
    headers.set("Cache-Control", "no-store");
    const fallbackFile =
      status.cursor?.replace(/[:.]/g, "-") ?? new Date().toISOString().replace(/[:.]/g, "-");
    const filename =
      upstream.headers.get("content-disposition")?.match(/filename="?(.+?)"?$/)?.[1] ??
      `${fallbackFile || "guardrail-followups"}-${DEFAULT_FILENAME}`;
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);

    return new NextResponse(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Guardrail export proxy error", error);
    return NextResponse.json({ error: "Unable to proxy guardrail export" }, { status: 500 });
  }
}

