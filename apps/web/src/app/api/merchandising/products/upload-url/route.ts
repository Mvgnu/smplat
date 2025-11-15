import { NextResponse } from "next/server";

import { requireRole } from "@/server/auth/policies";
import { createSignedProductUpload, isSignedUploadEnabled } from "@/server/storage/uploads";

type UploadRequestPayload = {
  fileName?: string;
  contentType?: string;
  contentLength?: number;
};

export async function POST(request: Request): Promise<NextResponse> {
  await requireRole("operator", {
    context: {
      route: "api.merchandising.products.uploadUrl",
      method: "POST",
    },
  });

  if (!isSignedUploadEnabled()) {
    return NextResponse.json(
      { error: "Signed uploads are not configured. Set ASSET_BUCKET and related env vars." },
      { status: 503 },
    );
  }

  let payload: UploadRequestPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Upload request body must be valid JSON." }, { status: 400 });
  }

  const fileName = typeof payload.fileName === "string" && payload.fileName.trim().length > 0 ? payload.fileName : null;
  if (!fileName) {
    return NextResponse.json({ error: "fileName is required." }, { status: 400 });
  }

  const contentLength =
    typeof payload.contentLength === "number" && Number.isFinite(payload.contentLength) && payload.contentLength > 0
      ? payload.contentLength
      : undefined;

  try {
    const signedUpload = await createSignedProductUpload({
      fileName,
      contentType: typeof payload.contentType === "string" ? payload.contentType : undefined,
      contentLength,
    });
    return NextResponse.json(signedUpload, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Unable to mint upload URL.",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
