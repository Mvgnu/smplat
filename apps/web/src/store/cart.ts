"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type {
  CartAddOnSelection,
  CartCustomFieldValue,
  CartItem,
  CartOptionSelection,
  CartProductExperience,
  CartSubscriptionSelection,
} from "@/types/cart";

export type {
  CartAddOnSelection,
  CartCustomFieldValue,
  CartItem,
  CartOptionSelection,
  CartProductExperience,
  CartSubscriptionSelection,
} from "@/types/cart";

type CartState = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "id" | "quantity">) => void;
  updateQuantity: (itemId: string, quantity: number) => void;
  removeItem: (itemId: string) => void;
  clear: () => void;
};

const normalizeOptions = (options: CartOptionSelection[]): string =>
  JSON.stringify(
    [...options].sort((a, b) => {
      if (a.groupId === b.groupId) {
        return a.optionId.localeCompare(b.optionId);
      }
      return a.groupId.localeCompare(b.groupId);
    })
  );

const normalizeAddOns = (addOns: CartAddOnSelection[]): string =>
  JSON.stringify([...addOns].sort((a, b) => a.id.localeCompare(b.id)));

const normalizeCustomFields = (fields: CartCustomFieldValue[]): string =>
  JSON.stringify([...fields].sort((a, b) => a.id.localeCompare(b.id)));

function isSameConfiguration(existing: CartItem, incoming: Omit<CartItem, "id" | "quantity">): boolean {
  return (
    existing.productId === incoming.productId &&
    existing.currency === incoming.currency &&
    normalizeOptions(existing.selectedOptions) === normalizeOptions(incoming.selectedOptions) &&
    normalizeAddOns(existing.addOns) === normalizeAddOns(incoming.addOns) &&
    normalizeCustomFields(existing.customFields) === normalizeCustomFields(incoming.customFields) &&
    JSON.stringify(existing.subscriptionPlan ?? null) === JSON.stringify(incoming.subscriptionPlan ?? null) &&
    (existing.platformContext?.id ?? null) === (incoming.platformContext?.id ?? null)
  );
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      addItem: (item) =>
        set((state) => {
          const existingIndex = state.items.findIndex((current) => isSameConfiguration(current, item));

          if (existingIndex >= 0) {
            const updatedItems = [...state.items];
            const existingItem = updatedItems[existingIndex];
            updatedItems[existingIndex] = {
              ...existingItem,
              quantity: existingItem.quantity + 1,
              presetId: existingItem.presetId ?? item.presetId ?? null,
              presetLabel: existingItem.presetLabel ?? item.presetLabel ?? null,
              experience: existingItem.experience ?? item.experience ?? undefined,
              platformContext: existingItem.platformContext ?? item.platformContext ?? null,
            };
            return { items: updatedItems };
          }

          const newItem: CartItem = {
            ...item,
            id: crypto.randomUUID(),
            quantity: 1,
            presetId: item.presetId ?? null,
            presetLabel: item.presetLabel ?? null,
            experience: item.experience ?? undefined,
            platformContext: item.platformContext ?? null,
          };

          return { items: [...state.items, newItem] };
        }),
      updateQuantity: (itemId, quantity) =>
        set((state) => {
          if (quantity <= 0) {
            return { items: state.items.filter((item) => item.id !== itemId) };
          }
          return {
            items: state.items.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    quantity
                  }
                : item
            )
          };
        }),
      removeItem: (itemId) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== itemId)
        })),
      clear: () => set({ items: [] })
    }),
    {
      name: "smplat-cart",
      storage: createJSONStorage(() => localStorage)
    }
  )
);

export const cartTotalSelector = (state: CartState): number =>
  state.items.reduce((acc, item) => acc + item.unitPrice * item.quantity, 0);
