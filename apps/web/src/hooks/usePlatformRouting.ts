'use client';

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { mergeStorefrontParamsIntoUrl } from "@/lib/storefront-query";

export function usePlatformRouteUpdater(): (platformId: string | null) => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (platformId: string | null) => {
      const basePath = pathname || "/";
      const query = searchParams?.toString();
      const currentPath = query && query.length > 0 ? `${basePath}?${query}` : basePath;
      const nextUrl = mergeStorefrontParamsIntoUrl(currentPath, {
        platform: platformId ?? undefined,
      });
      router.replace(nextUrl, { scroll: false });
    },
    [router, pathname, searchParams]
  );
}
