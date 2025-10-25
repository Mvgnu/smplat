"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ConfiguratorSelection } from "@/components/products/product-configurator";

export type SavedConfigurationSelection = ConfiguratorSelection;

export type SavedConfiguration = {
  id: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  label: string;
  currency: string;
  total: number;
  selection: SavedConfigurationSelection;
  createdAt: string;
  updatedAt: string;
};

type SavedConfigurationsState = {
  configurations: SavedConfiguration[];
  saveConfiguration: (
    configuration: Omit<SavedConfiguration, "id" | "createdAt" | "updatedAt">
  ) => SavedConfiguration;
  updateConfigurationLabel: (id: string, label: string) => void;
  deleteConfiguration: (id: string) => void;
  clearForProduct: (productId: string) => void;
};

const sortRecordKeys = (record: Record<string, string[]>): Record<string, string[]> => {
  const keys = Object.keys(record).sort((a, b) => a.localeCompare(b));
  return Object.fromEntries(
    keys.map((key) => [key, [...record[key]].sort((a, b) => a.localeCompare(b))])
  );
};

const normalizeSelection = (selection: SavedConfigurationSelection): string => {
  const normalizedOptions = sortRecordKeys(selection.selectedOptions);
  const normalizedAddOns = [...selection.addOns].sort((a, b) => a.localeCompare(b));
  const normalizedFields = Object.fromEntries(
    Object.entries(selection.customFieldValues).sort(([a], [b]) => a.localeCompare(b))
  );
  return JSON.stringify({
    options: normalizedOptions,
    addOns: normalizedAddOns,
    subscriptionPlanId: selection.subscriptionPlanId ?? null,
    customFields: normalizedFields,
  });
};

export const useSavedConfigurationsStore = create<SavedConfigurationsState>()(
  persist(
    (set) => ({
      configurations: [],
      saveConfiguration: (configuration) => {
        const now = new Date().toISOString();
        const record: SavedConfiguration = {
          ...configuration,
          id: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
        };
        const incomingSignature = normalizeSelection(configuration.selection);
        set((state) => {
          const filtered = state.configurations.filter(
            (existing) =>
              !(
                existing.productId === configuration.productId &&
                normalizeSelection(existing.selection) === incomingSignature
              )
          );
          return {
            configurations: [record, ...filtered].slice(0, 20),
          };
        });
        return record;
      },
      updateConfigurationLabel: (id, label) =>
        set((state) => ({
          configurations: state.configurations.map((config) =>
            config.id === id
              ? {
                  ...config,
                  label,
                  updatedAt: new Date().toISOString(),
                }
              : config
          ),
        })),
      deleteConfiguration: (id) =>
        set((state) => ({
          configurations: state.configurations.filter((config) => config.id !== id),
        })),
      clearForProduct: (productId) =>
        set((state) => ({
          configurations: state.configurations.filter((config) => config.productId !== productId),
        })),
    }),
    {
      name: "smplat-saved-configurations",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
