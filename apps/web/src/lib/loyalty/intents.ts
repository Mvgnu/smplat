import type {
  LoyaltyCheckoutIntent,
  LoyaltyNextActionCard
} from "@smplat/types";

const STORAGE_KEY = "smplat.loyalty.checkout-intents";
const TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

type StoredIntentRecord = {
  intent: LoyaltyCheckoutIntent;
  orderId?: string | null;
  seenOnSuccess: boolean;
  seenOnLoyalty: boolean;
};

type StoredPayload = {
  version: number;
  records: StoredIntentRecord[];
  persistedAt: string;
};

function now(): number {
  return Date.now();
}

function safeWindow(): Window | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window;
}

function readStorage(): StoredIntentRecord[] {
  const target = safeWindow();
  if (!target) {
    return [];
  }

  try {
    const raw = target.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const payload = JSON.parse(raw) as StoredPayload;
    if (!payload || typeof payload !== "object" || payload.version !== 1) {
      return [];
    }
    const freshBoundary = now() - TTL_MS;
    return payload.records.filter((record) => {
      const createdAt = Date.parse(record.intent.createdAt ?? "");
      return !Number.isNaN(createdAt) && createdAt >= freshBoundary;
    });
  } catch (error) {
    console.warn("Failed to read loyalty intent storage", error);
    return [];
  }
}

function writeStorage(records: StoredIntentRecord[]): void {
  const target = safeWindow();
  if (!target) {
    return;
  }

  try {
    const payload: StoredPayload = {
      version: 1,
      records,
      persistedAt: new Date().toISOString()
    };
    target.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to persist loyalty intents", error);
  }
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `loyalty-intent-${now()}`;
}

export function queueCheckoutIntents(intents: Array<Omit<LoyaltyCheckoutIntent, "id" | "createdAt">>): LoyaltyCheckoutIntent[] {
  const createdAt = new Date().toISOString();
  const enriched = intents.map((intent) => ({
    ...intent,
    id: generateId(),
    createdAt,
    metadata: intent.metadata ?? {}
  }));

  const existing = readStorage();
  const merged: StoredIntentRecord[] = [
    ...existing,
    ...enriched.map((intent) => ({
      intent,
      orderId: null,
      seenOnSuccess: false,
      seenOnLoyalty: false
    }))
  ];
  writeStorage(merged);
  return enriched;
}

function upsert(records: StoredIntentRecord[]): void {
  writeStorage(records.filter((record) => record.intent));
}

export function consumeSuccessIntents(orderId: string | null = null): LoyaltyCheckoutIntent[] {
  const records = readStorage();
  if (records.length === 0) {
    return [];
  }

  const freshBoundary = now() - TTL_MS;
  const updated: StoredIntentRecord[] = [];
  const intents: LoyaltyCheckoutIntent[] = [];
  records.forEach((record) => {
    const createdAt = Date.parse(record.intent.createdAt ?? "");
    if (Number.isNaN(createdAt) || createdAt < freshBoundary) {
      return;
    }
    if (!record.seenOnSuccess) {
      const nextMetadata = {
        ...(record.intent.metadata ?? {}),
        orderId: orderId ?? record.orderId ?? null
      };
      const intentWithOrder: LoyaltyCheckoutIntent = {
        ...record.intent,
        metadata: nextMetadata
      };
      intents.push(intentWithOrder);
      updated.push({
        ...record,
        intent: intentWithOrder,
        seenOnSuccess: true,
        orderId: orderId ?? record.orderId ?? null
      });
    } else {
      updated.push(record);
    }
  });

  if (intents.length > 0 || updated.length !== records.length) {
    upsert(updated);
  }
  return intents;
}

export function consumeLoyaltyNextActions(): LoyaltyNextActionCard[] {
  const records = readStorage();
  if (records.length === 0) {
    return [];
  }

  const freshBoundary = now() - TTL_MS;
  const updated: StoredIntentRecord[] = [];
  const actions: LoyaltyNextActionCard[] = [];

  records.forEach((record) => {
    const createdAt = Date.parse(record.intent.createdAt ?? "");
    if (Number.isNaN(createdAt) || createdAt < freshBoundary) {
      return;
    }

    const card = buildNextAction(record.intent);
    if (!record.seenOnLoyalty) {
      actions.push(card);
      updated.push({ ...record, seenOnLoyalty: true });
    } else if (!record.seenOnSuccess) {
      updated.push(record);
    } else {
      // Already seen across surfaces; retain until TTL for reconciliation.
      updated.push(record);
    }
  });

  upsert(updated);
  return actions;
}

export function clearResolvedIntents(predicate?: (intent: LoyaltyCheckoutIntent) => boolean): void {
  const records = readStorage();
  if (records.length === 0) {
    return;
  }

  const filtered = records.filter((record) => {
    if (predicate && predicate(record.intent)) {
      return false;
    }
    if (record.seenOnSuccess && record.seenOnLoyalty) {
      return false;
    }
    const createdAt = Date.parse(record.intent.createdAt ?? "");
    return Number.isNaN(createdAt) ? false : createdAt >= now() - TTL_MS;
  });

  writeStorage(filtered);
}

function buildNextAction(intent: LoyaltyCheckoutIntent): LoyaltyNextActionCard {
  if (intent.kind === "redemption") {
    const rewardName = intent.rewardName ?? intent.rewardSlug ?? "Reward";
    const points = intent.pointsCost ? Math.round(intent.pointsCost) : null;
    return {
      id: intent.id,
      kind: intent.kind,
      headline: `Confirm redemption for ${rewardName}`,
      description:
        points && points > 0
          ? `Hold ${points} points and finish fulfillment for ${rewardName}.`
          : `Finalize your planned redemption for ${rewardName}.`,
      ctaLabel: "Redeem now",
      createdAt: intent.createdAt,
      expiresAt: intent.expiresAt ?? null,
      metadata: {
        rewardSlug: intent.rewardSlug,
        rewardName,
        pointsCost: intent.pointsCost,
        quantity: intent.quantity ?? 1,
        orderId: intent.metadata?.orderId ?? null
      }
    };
  }

  const referralCode = intent.referralCode ?? "";
  const channel = intent.channel ?? "referral";
  return {
    id: intent.id,
    kind: intent.kind,
    headline: "Follow up on your referral share",
    description: referralCode
      ? `Close the loop on your ${channel} share for code ${referralCode}.`
      : "Close the loop on your referral outreach.",
    ctaLabel: "View referrals",
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt ?? null,
    metadata: {
      referralCode,
      channel,
      orderId: intent.metadata?.orderId ?? null
    }
  };
}
