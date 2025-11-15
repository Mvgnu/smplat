#!/usr/bin/env node

import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const bucket = process.env.ASSET_BUCKET;
const region = process.env.ASSET_REGION ?? "us-east-1";
const endpoint = process.env.ASSET_S3_ENDPOINT;
const forcePathStyle = process.env.ASSET_S3_FORCE_PATH_STYLE === "true";
const prefix =
  process.env.ASSET_CLEANUP_PREFIX ??
  `${process.env.ASSET_UPLOAD_PREFIX ?? "product-media/tmp"}`.replace(/\/+$/, "") + "/";
const maxAgeMinutes = Number(process.env.ASSET_CLEANUP_MAX_AGE_MINUTES ?? 60);

if (!bucket) {
  console.error("ASSET_BUCKET is required to run the cleanup job.");
  process.exit(1);
}

const cutoff = Date.now() - Math.max(maxAgeMinutes, 5) * 60 * 1000;

const client = new S3Client({
  region,
  endpoint,
  forcePathStyle: forcePathStyle || Boolean(endpoint),
});

async function listStaleObjects() {
  const stale = [];
  let continuationToken;

  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = response.Contents ?? [];
    for (const object of objects) {
      if (!object.Key || !object.LastModified) {
        continue;
      }
      if (object.LastModified.getTime() < cutoff) {
        stale.push({ Key: object.Key });
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return stale;
}

async function deleteObjects(keys) {
  if (keys.length === 0) {
    return;
  }

  const chunks = [];
  for (let i = 0; i < keys.length; i += 1000) {
    chunks.push(keys.slice(i, i + 1000));
  }

  for (const chunk of chunks) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk },
      }),
    );
    console.log(`Deleted ${chunk.length} objects from ${bucket}`);
  }
}

async function main() {
  console.log(
    `Scanning ${bucket}/${prefix || ""} for objects older than ${Math.max(
      maxAgeMinutes,
      5,
    )} minutes (cutoff ${new Date(cutoff).toISOString()})`,
  );
  const stale = await listStaleObjects();
  if (stale.length === 0) {
    console.log("No stale uploads found.");
    return;
  }
  console.log(`Found ${stale.length} stale objects. Deleting...`);
  await deleteObjects(stale);
  console.log("Cleanup complete.");
}

main().catch((error) => {
  console.error("Failed to run asset upload cleanup:", error);
  process.exit(1);
});
