"use client";

import type { GuardrailAttachmentMetadata } from "@/types/reporting";

export type GuardrailAttachment = GuardrailAttachmentMetadata;

type SignedUploadResponse = {
  uploadUrl: string;
  storageKey: string;
  assetUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
};

export async function uploadGuardrailAttachment(file: File): Promise<GuardrailAttachment> {
  const payload = {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    contentLength: file.size,
  };
  const response = await fetch("/api/reporting/guardrail-attachments/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error("Failed to request upload URL");
  }
  const signed = (await response.json()) as SignedUploadResponse;
  const uploadHeaders = signed.headers ?? { "Content-Type": file.type || "application/octet-stream" };
  const uploadResult = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: uploadHeaders,
    body: file,
  });
  if (!uploadResult.ok) {
    throw new Error("File upload failed");
  }
  return {
    id: signed.storageKey,
    fileName: file.name,
    assetUrl: signed.assetUrl,
    storageKey: signed.storageKey,
    size: file.size,
    contentType: file.type || "application/octet-stream",
    uploadedAt: new Date().toISOString(),
  };
}
