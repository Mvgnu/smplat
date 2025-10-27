"use client";

// meta: component: QueryProvider
// meta: feature: marketing-preview-cockpit

import { useEffect, useState, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager
} from "@tanstack/react-query";

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        retry: 1
      }
    }
  });

type QueryProviderProps = {
  children: ReactNode;
};

export function QueryProvider({ children }: QueryProviderProps) {
  const [client] = useState(createQueryClient);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleVisibility = () => {
      focusManager.setFocused(document.visibilityState === "visible");
    };

    const handleOnlineStatus = () => {
      onlineManager.setOnline(navigator.onLine);
    };

    handleVisibility();
    handleOnlineStatus();

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("online", handleOnlineStatus);
    window.addEventListener("offline", handleOnlineStatus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("online", handleOnlineStatus);
      window.removeEventListener("offline", handleOnlineStatus);
    };
  }, []);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
