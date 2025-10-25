#!/usr/bin/env node
import dotenv from "dotenv";
import { setTimeout as wait } from "node:timers/promises";

// meta: validation:payload-preview
for (const path of [".env", "apps/web/.env", "apps-cms-payload/.env"]) {
  dotenv.config({ path, override: false });
}

const requiredEnv = ["WEB_URL", "PAYLOAD_PREVIEW_SECRET", "PAYLOAD_REVALIDATE_SECRET"];
const missing = requiredEnv.filter((name) => !process.env[name] || process.env[name]?.length === 0);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const webUrl = process.env.WEB_URL;
const previewSecret = process.env.PAYLOAD_PREVIEW_SECRET;
const revalidateSecret = process.env.PAYLOAD_REVALIDATE_SECRET;
const environment = process.env.PAYLOAD_INTEGRATION_ENV || process.env.CMS_ENV || "test";
const previewPath = normalizePath(
  process.env.PAYLOAD_VALIDATION_PREVIEW_PATH || "/blog/sample-post"
);
const blogSlug = process.env.PAYLOAD_VALIDATION_BLOG_SLUG || "automation-workflows";
const logger = createLogger();

async function main() {
  await validatePreviewEndpoint();
  await wait(250);
  await validateRevalidateWebhook();
  logger.success("Payload preview and webhook validation completed.");
}

async function validatePreviewEndpoint() {
  const previewUrl = new URL("/api/preview", webUrl);
  previewUrl.searchParams.set("secret", previewSecret);
  previewUrl.searchParams.set("provider", "payload");
  previewUrl.searchParams.set("redirect", previewPath);

  logger.step(`Validating preview endpoint via ${previewUrl.toString()}`);
  const response = await fetch(previewUrl, {
    headers: { Accept: "application/json" },
    redirect: "manual"
  });

  if (response.status !== 307) {
    const body = await safeReadBody(response);
    throw new Error(`Expected HTTP 307 redirect, received ${response.status}. Body: ${body}`);
  }

  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Preview response missing Location header");
  }

  const expectedLocation = new URL(previewPath, webUrl);
  expectedLocation.searchParams.set("previewProvider", "payload");
  if (new URL(location).toString() !== expectedLocation.toString()) {
    throw new Error(
      `Preview redirect mismatch. Expected ${expectedLocation.toString()} received ${location}`
    );
  }

  const setCookie = response.headers.get("set-cookie") ?? "";
  if (!setCookie.includes("smplat-preview-provider=payload")) {
    throw new Error("Preview response missing provider cookie");
  }

  logger.success("Preview endpoint returned expected redirect and cookie.");
}

async function validateRevalidateWebhook() {
  const revalidateUrl = new URL("/api/revalidate", webUrl);
  revalidateUrl.searchParams.set("provider", "payload");

  const payload = {
    collection: "blog-posts",
    doc: {
      slug: blogSlug,
      environment
    },
    environment
  };

  logger.step(`Triggering webhook validation via ${revalidateUrl.toString()}`);
  const response = await fetch(revalidateUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-cms-provider": "payload",
      "x-payload-signature": revalidateSecret
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (response.status !== 200) {
    throw new Error(`Expected HTTP 200 from webhook handler, received ${response.status}. Body: ${JSON.stringify(body)}`);
  }

  if (!body?.revalidated) {
    throw new Error(`Webhook response did not confirm revalidation: ${JSON.stringify(body)}`);
  }

  const expectedPaths = ["/blog", `/blog/${normalizeSlug(blogSlug)}`];
  const receivedPaths = Array.isArray(body.paths) ? body.paths.map(String) : [];
  for (const path of expectedPaths) {
    if (!receivedPaths.includes(path)) {
      throw new Error(
        `Webhook response missing expected path ${path}. Received: ${receivedPaths.join(", ")}`
      );
    }
  }

  logger.success("Webhook handler accepted payload signature and scheduled paths.");
}

function normalizePath(value) {
  if (!value || typeof value !== "string") return "/";
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return new URL(value).pathname;
  }
  return value.startsWith("/") ? value : `/${value.replace(/^\/+/, "")}`;
}

function normalizeSlug(value) {
  return value.replace(/^\/+/, "");
}

async function safeReadBody(response) {
  try {
    return await response.text();
  } catch (error) {
    return `<<failed to read response body: ${error instanceof Error ? error.message : String(error)}>>`;
  }
}

function createLogger() {
  return {
    step(message) {
      console.log(`➡️  ${message}`);
    },
    success(message) {
      console.log(`✅ ${message}`);
    }
  };
}

main().catch((error) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
