import "server-only";

import { cookies } from "next/headers";

import {
  DEFAULT_STOREFRONT_STATE,
  STOREFRONT_STATE_COOKIE,
  parseStorefrontState,
  type StorefrontStateSnapshot,
} from "@/shared/storefront-state";

export function getStorefrontStateFromCookies(): StorefrontStateSnapshot {
  const cookieStore = cookies();
  const cookieValue = cookieStore.get(STOREFRONT_STATE_COOKIE)?.value ?? null;
  if (!cookieValue) {
    return { ...DEFAULT_STOREFRONT_STATE };
  }
  return parseStorefrontState(cookieValue);
}
