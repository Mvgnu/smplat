import { randomUUID } from "crypto";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type SignedUploadRequest = {
  fileName: string;
  contentType?: string;
  contentLength?: number;
};

export type SignedUploadResponse = {
  uploadUrl: string;
  storageKey: string;
  assetUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
};

const assetBucket = process.env.ASSET_BUCKET ?? "";
const assetRegion = process.env.ASSET_REGION ?? "us-east-1";
const assetPrefix = process.env.ASSET_UPLOAD_PREFIX ?? "product-media";
const assetPublicBaseUrl =
  process.env.ASSET_PUBLIC_BASE_URL ??
  (assetBucket ? `https://${assetBucket}.s3.${assetRegion}.amazonaws.com` : "");
const assetEndpoint = process.env.ASSET_S3_ENDPOINT;
const assetForcePathStyle = process.env.ASSET_S3_FORCE_PATH_STYLE === "true";
const uploadExpirySeconds = Number(process.env.ASSET_UPLOAD_EXPIRY_SECONDS ?? 300);

const s3Client =
  assetBucket && assetRegion
    ? new S3Client({
        region: assetRegion,
        endpoint: assetEndpoint,
        forcePathStyle: assetForcePathStyle || Boolean(assetEndpoint),
      })
    : null;

const sanitizeFileName = (name: string): string => {
  const trimmed = name.trim().toLowerCase();
  const base = trimmed.replace(/[^a-z0-9._-]/gi, "-");
  return base.replace(/-+/g, "-").replace(/^-|-$/g, "");
};

export function isSignedUploadEnabled(): boolean {
  return Boolean(s3Client && assetBucket && assetPublicBaseUrl);
}

type SignedUploadOptions = {
  prefix?: string;
};

const buildStoragePrefix = (prefix?: string): string => {
  const value = (prefix ?? assetPrefix ?? "").trim();
  if (!value) {
    return "uploads";
  }
  return value.replace(/\/+$/, "");
};

export async function createSignedProductUpload(
  request: SignedUploadRequest,
  options?: SignedUploadOptions,
): Promise<SignedUploadResponse> {
  if (!isSignedUploadEnabled() || !s3Client) {
    throw new Error("Signed uploads are not configured. Set ASSET_BUCKET and ASSET_PUBLIC_BASE_URL.");
  }

  const safeName = sanitizeFileName(request.fileName || "asset");
  const prefix = buildStoragePrefix(options?.prefix);
  const storageKey = `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
  const contentType = request.contentType && request.contentType.length > 0
    ? request.contentType
    : "application/octet-stream";

  const command = new PutObjectCommand({
    Bucket: assetBucket,
    Key: storageKey,
    ContentType: contentType,
    ContentLength: request.contentLength,
    ACL: process.env.ASSET_S3_ACL ?? "private",
  });

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: Number.isFinite(uploadExpirySeconds) && uploadExpirySeconds > 0 ? uploadExpirySeconds : 300,
  });

  const expiresAt = new Date(Date.now() + (uploadExpirySeconds > 0 ? uploadExpirySeconds : 300) * 1000).toISOString();
  const assetUrl = `${assetPublicBaseUrl.replace(/\/+$/, "")}/${storageKey}`;

  return {
    uploadUrl: signedUrl,
    storageKey,
    assetUrl,
    expiresAt,
    headers: {
      "Content-Type": contentType,
    },
  };
}
