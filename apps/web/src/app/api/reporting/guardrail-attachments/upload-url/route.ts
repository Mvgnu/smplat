import { NextResponse } from "next/server";

import { createSignedProductUpload, isSignedUploadEnabled } from "@/server/storage/uploads";

const GUARDRAIL_ATTACHMENT_PREFIX =
  process.env.GUARDRAIL_ATTACHMENT_PREFIX ?? "guardrail-evidence";

type UploadRequest = {
  fileName?: string;
  contentType?: string;
  contentLength?: number;
};

export async function POST(request: Request) {
  if (!isSignedUploadEnabled()) {
    return NextResponse.json(
      { error: "Signed uploads are not configured." },
      { status: 503 },
    );
  }

  try {
    const payload = (await request.json().catch(() => ({}))) as UploadRequest;
    const fileName =
      typeof payload.fileName === "string" && payload.fileName.trim().length > 0
        ? payload.fileName.trim()
        : null;
    if (!fileName) {
      return NextResponse.json({ error: "fileName is required." }, { status: 400 });
    }
    const contentType =
      typeof payload.contentType === "string" && payload.contentType.length > 0
        ? payload.contentType
        : undefined;
    const contentLength =
      typeof payload.contentLength === "number" && Number.isFinite(payload.contentLength)
        ? payload.contentLength
        : undefined;

    const signedUpload = await createSignedProductUpload(
      {
        fileName,
        contentType,
        contentLength,
      },
      { prefix: GUARDRAIL_ATTACHMENT_PREFIX },
    );
    return NextResponse.json(signedUpload, { status: 200 });
  } catch (error) {
    console.error("Failed to mint guardrail attachment upload URL", error);
    return NextResponse.json(
      { error: "Unable to mint guardrail attachment upload URL." },
      { status: 500 },
    );
  }
}
