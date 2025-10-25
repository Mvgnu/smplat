import { cookies, draftMode } from "next/headers";

import { cmsProvider, resolvePreviewSecret, type CmsProvider } from "@/server/cms/config";
import { cmsLogger } from "@/server/observability/logger";
import { recordPreviewMetric } from "@/server/observability/cms-telemetry";

const toProvider = (value: string | null): CmsProvider | undefined => {
  if (value === "sanity" || value === "payload") {
    return value;
  }
  return undefined;
};

const matchSecret = (secret: string | null, provider: CmsProvider): provider is CmsProvider => {
  const expected = resolvePreviewSecret(provider);
  return Boolean(expected && secret === expected);
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const redirect = searchParams.get("redirect") ?? "/";
  const providerParam = toProvider(searchParams.get("provider"));
  const provider = providerParam ?? cmsProvider;

  if (!secret) {
    recordPreviewMetric("missing_secret");
    cmsLogger.warn("preview denied: missing secret", { provider });
    return Response.json({ error: "Missing preview secret" }, { status: 400 });
  }

  const providersToCheck: CmsProvider[] = provider === "payload" ? ["payload", "sanity"] : ["sanity", "payload"];
  const authorizedProvider = providersToCheck.find((candidate) => matchSecret(secret, candidate));

  if (!authorizedProvider) {
    recordPreviewMetric("invalid_secret");
    cmsLogger.warn("preview denied: invalid secret", { provider });
    return Response.json({ error: "Invalid preview secret" }, { status: 401 });
  }

  const sanitizedRedirect = sanitizeRedirect(redirect, request);
  if (!sanitizedRedirect) {
    recordPreviewMetric("invalid_redirect");
    cmsLogger.warn("preview denied: invalid redirect", {
      provider: authorizedProvider,
      redirect
    });
    return Response.json({ error: "Invalid redirect" }, { status: 400 });
  }

  draftMode().enable();
  const cookieStore = cookies();
  cookieStore.set("smplat-preview-provider", authorizedProvider, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60
  });

  const requestUrl = new URL(request.url);
  const location = new URL(sanitizedRedirect, requestUrl.origin);
  location.searchParams.set("previewProvider", authorizedProvider);

  recordPreviewMetric("success");
  cmsLogger.info("preview enabled", {
    provider: authorizedProvider,
    redirect: sanitizedRedirect
  });

  return new Response(null, {
    status: 307,
    headers: {
      Location: location.toString()
    }
  });
}

export async function DELETE() {
  draftMode().disable();
  recordPreviewMetric("success");
  cmsLogger.info("preview disabled", {});
  return Response.json({ preview: false });
}

const sanitizeRedirect = (value: string, request: Request) => {
  // meta: preview-safety:redirect-validation
  const trimmed = value.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed.startsWith("//")) {
    return null;
  }
  const normalizedValue =
    trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")
      ? trimmed
      : `/${trimmed.replace(/^\/+/, "")}`;
  const requestUrl = new URL(request.url);
  try {
    const target = normalizedValue.startsWith("http://") || normalizedValue.startsWith("https://")
      ? new URL(normalizedValue)
      : new URL(normalizedValue, requestUrl.origin);
    if (target.origin !== requestUrl.origin) {
      return null;
    }
    const pathWithQuery = `${target.pathname}${target.search}${target.hash}`;
    if (!pathWithQuery.startsWith("/")) {
      return `/${pathWithQuery}`;
    }
    return pathWithQuery || "/";
  } catch {
    return null;
  }
};
