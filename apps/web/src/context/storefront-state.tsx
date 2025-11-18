'use client';

import { createContext, useContext, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { createStore } from "zustand";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import {
  DEFAULT_STOREFRONT_STATE,
  STOREFRONT_STATE_COOKIE,
  STOREFRONT_STATE_STORAGE_KEY,
  type StorefrontExperimentExposure,
  type StorefrontLoyaltySnapshot,
  type StorefrontPlatformSelection,
  type StorefrontStateSnapshot,
  parseStorefrontState,
  serializeStorefrontState,
} from "@/shared/storefront-state";
import { readStorefrontQueryParams } from "@/lib/storefront-query";

type StorefrontState = StorefrontStateSnapshot & {
  setPlatform: (platform: StorefrontPlatformSelection | null) => void;
  setLoyaltySnapshot: (snapshot: StorefrontLoyaltySnapshot | null) => void;
  setExperimentExposure: (exposure: StorefrontExperimentExposure | null) => void;
  hydrateFromSnapshot: (snapshot: StorefrontStateSnapshot) => void;
};

const StorefrontStateContext = createContext<StoreApi<StorefrontState> | null>(null);

const snapshotFromState = (state: StorefrontState): StorefrontStateSnapshot => ({
  platform: state.platform,
  loyaltySnapshot: state.loyaltySnapshot,
  experimentExposure: state.experimentExposure,
});

const persistSnapshot = (snapshot: StorefrontStateSnapshot) => {
  if (typeof window === "undefined") {
    return;
  }
  const payload = serializeStorefrontState(snapshot);
  try {
    window.localStorage.setItem(STOREFRONT_STATE_STORAGE_KEY, payload);
  } catch {
    // ignore storage failures
  }
  try {
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    document.cookie = `${STOREFRONT_STATE_COOKIE}=${encodeURIComponent(
      payload
    )}; path=/; expires=${expires.toUTCString()}`;
  } catch {
    // ignore cookie failures
  }
};

const readClientSnapshot = (): StorefrontStateSnapshot | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const stored = window.localStorage.getItem(STOREFRONT_STATE_STORAGE_KEY);
    if (stored) {
      return parseStorefrontState(stored);
    }
  } catch {
    // ignore parse failures
  }
  try {
    const cookie = document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${STOREFRONT_STATE_COOKIE}=`));
    if (cookie) {
      const [, value] = cookie.split("=");
      if (value) {
        return parseStorefrontState(decodeURIComponent(value));
      }
    }
  } catch {
    // ignore cookie parse failures
  }
  return null;
};

const formatPlatformLabel = (value: string): string =>
  value
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const createStorefrontStore = (
  baseState: StorefrontStateSnapshot = DEFAULT_STOREFRONT_STATE
): StoreApi<StorefrontState> =>
  createStore<StorefrontState>()((set, get) => ({
    ...baseState,
    setPlatform: (platform) => {
      set((state) => ({ ...state, platform }));
      persistSnapshot(snapshotFromState(get()));
    },
    setLoyaltySnapshot: (loyaltySnapshot) => {
      set((state) => ({ ...state, loyaltySnapshot }));
      persistSnapshot(snapshotFromState(get()));
    },
    setExperimentExposure: (experimentExposure) => {
      set((state) => ({ ...state, experimentExposure }));
      persistSnapshot(snapshotFromState(get()));
    },
    hydrateFromSnapshot: (snapshot) => {
      set((state) => ({
        ...state,
        platform: snapshot.platform,
        loyaltySnapshot: snapshot.loyaltySnapshot,
        experimentExposure: snapshot.experimentExposure,
      }));
      persistSnapshot(snapshotFromState(get()));
    },
  }));

type ProviderProps = {
  children: ReactNode;
  initialState?: StorefrontStateSnapshot;
};

export function StorefrontStateProvider({ children, initialState }: ProviderProps) {
  const storeRef = useRef<StoreApi<StorefrontState>>();
  if (!storeRef.current) {
    storeRef.current = createStorefrontStore(initialState ?? DEFAULT_STOREFRONT_STATE);
  }

  useEffect(() => {
    const store = storeRef.current;
    if (!store) {
      return;
    }
    const snapshot = readClientSnapshot();
    if (snapshot) {
      store.getState().hydrateFromSnapshot(snapshot);
    }
    const params = typeof window !== "undefined" ? readStorefrontQueryParams(window.location.search) : {};
    if (params.platform) {
      store.getState().setPlatform({
        id: params.platform,
        label: formatPlatformLabel(params.platform),
        handle: params.platform.startsWith("@") ? params.platform : undefined,
      });
    }
    if (params.loyaltyCampaign) {
      const current = store.getState().loyaltySnapshot ?? {};
      store.getState().setLoyaltySnapshot({
        ...current,
        loyaltyCampaign: params.loyaltyCampaign,
      });
    }
    if (params.experiment && params.variant) {
      const current = store.getState().experimentExposure ?? null;
      store.getState().setExperimentExposure({
        slug: params.experiment,
        variantKey: params.variant,
        variantName: current?.variantName ?? null,
        isControl: current?.isControl ?? null,
      });
    }
  }, []);

  return (
    <StorefrontStateContext.Provider value={storeRef.current}>
      {children}
    </StorefrontStateContext.Provider>
  );
}

const useStorefrontStore = <T,>(selector: (state: StorefrontState) => T): T => {
  const store = useContext(StorefrontStateContext);
  if (!store) {
    throw new Error("StorefrontStateProvider is missing from the component tree");
  }
  return useStore(store, selector);
};

export const usePlatformSelection = () =>
  useStorefrontStore((state) => state.platform);

export const useLoyaltySnapshot = () =>
  useStorefrontStore((state) => state.loyaltySnapshot);

export const useExperimentExposure = () =>
  useStorefrontStore((state) => state.experimentExposure);

export const useStorefrontStateActions = () =>
  useStorefrontStore((state) => ({
    setPlatform: state.setPlatform,
    setLoyaltySnapshot: state.setLoyaltySnapshot,
    setExperimentExposure: state.setExperimentExposure,
  }));

export const useStorefrontStateSnapshot = (): StorefrontStateSnapshot =>
  useStorefrontStore((state) => snapshotFromState(state));
