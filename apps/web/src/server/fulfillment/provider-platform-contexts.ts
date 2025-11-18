import "server-only";

import type { GuardrailPlatformContext } from "@/types/reporting";
import { apiBaseUrl, defaultHeaders } from "./providers";

type ProviderPlatformContextResponse = {
  providerId: string;
  contexts: Array<{
    id: string;
    label: string;
    handle?: string | null;
    platformType?: string | null;
  }>;
};

export async function fetchProviderPlatformContexts(
  providerIds: string[],
  limit = 3,
): Promise<Record<string, GuardrailPlatformContext[]>> {
  if (!providerIds.length) {
    return {};
  }
  const params = new URLSearchParams();
  providerIds.forEach((providerId) => {
    if (providerId) {
      params.append("providerId", providerId);
    }
  });
  params.set("limit", Math.max(1, Math.min(limit, 10)).toString());
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/fulfillment/providers/platform-contexts?${params.toString()}`, {
      method: "GET",
      headers: defaultHeaders,
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("Failed to fetch provider platform contexts", response.status, response.statusText);
      return {};
    }
    const payload = (await response.json()) as ProviderPlatformContextResponse[];
    const mapping: Record<string, GuardrailPlatformContext[]> = {};
    payload.forEach((entry) => {
      mapping[entry.providerId] = entry.contexts.map((context) => ({
        id: context.id,
        label: context.label,
        handle: context.handle ?? null,
        platformType: context.platformType ?? null,
      }));
    });
    return mapping;
  } catch (error) {
    console.error("Unable to load provider platform contexts", error);
    return {};
  }
}
