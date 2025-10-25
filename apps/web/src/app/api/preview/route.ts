import { draftMode } from "next/headers";

import { cmsProvider, resolvePreviewSecret, type CmsProvider } from "@/server/cms/config";

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
    return Response.json({ error: "Missing preview secret" }, { status: 400 });
  }

  const providersToCheck: CmsProvider[] = provider === "payload" ? ["payload", "sanity"] : ["sanity", "payload"];
  const authorizedProvider = providersToCheck.find((candidate) => matchSecret(secret, candidate));

  if (!authorizedProvider) {
    return Response.json({ error: "Invalid preview secret" }, { status: 401 });
  }

  draftMode().enable();

  const location = new URL(redirect, request.url);
  location.searchParams.set("previewProvider", authorizedProvider);

  return Response.redirect(location, 307);
}

export async function DELETE() {
  draftMode().disable();
  return Response.json({ preview: false });
}
