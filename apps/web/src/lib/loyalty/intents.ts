import type {
  LoyaltyCheckoutIntent,
  LoyaltyCheckoutIntentKind,
  LoyaltyNextActionCard,
  LoyaltyNextActionFeed
} from "@smplat/types";

const STORAGE_KEY = "smplat.loyalty.checkout-intents";
const TTL_MS = 1000 * 60 * 60 * 24;
const STORAGE_VERSION = 2;

export type CheckoutIntentDraft = {
  kind: LoyaltyCheckoutIntentKind;
  rewardSlug?: string | null;
  rewardName?: string | null;
  pointsCost?: number | null;
  quantity?: number | null;
  referralCode?: string | null;
  channel?: string | null;
  metadata?: Record<string, unknown>;
  expiresAt?: string | null;
};

type StoredIntentRecord = {
  clientIntentId: string;
  serverId?: string | null;
  intent: LoyaltyCheckoutIntent;
  orderId?: string | null;
  seenOnSuccess: boolean;
  seenOnLoyalty: boolean;
};

type StoredPayloadV2 = {
  version: 2;
  records: StoredIntentRecord[];
  persistedAt: string;
};

type LegacyStoredIntentRecord = {
  intent: Omit<LoyaltyCheckoutIntent, "clientIntentId" | "status" | "resolvedAt">;
  orderId?: string | null;
  seenOnSuccess: boolean;
  seenOnLoyalty: boolean;
};

type LegacyStoredPayload = {
  version: 1;
  records: LegacyStoredIntentRecord[];
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
    const payload = JSON.parse(raw) as StoredPayloadV2 | LegacyStoredPayload;
    if (!payload || typeof payload !== "object") {
      return [];
    }

    if (payload.version === STORAGE_VERSION) {
      const freshBoundary = now() - TTL_MS;
      return payload.records.filter((record) => {
        const createdAt = Date.parse(record.intent.createdAt ?? "");
        return !Number.isNaN(createdAt) && createdAt >= freshBoundary;
      });
    }

    if ((payload as LegacyStoredPayload).version === 1) {
      const legacy = payload as LegacyStoredPayload;
      return legacy.records.map((record) => convertLegacyRecord(record)).filter(Boolean) as StoredIntentRecord[];
    }

    return [];
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
    const payload: StoredPayloadV2 = {
      version: STORAGE_VERSION,
      records,
      persistedAt: new Date().toISOString()
    };
    target.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to persist loyalty intents", error);
  }
}

function convertLegacyRecord(record: LegacyStoredIntentRecord): StoredIntentRecord | null {
  const intent = record.intent;
  if (!intent || !intent.id) {
    return null;
  }

  const normalized: LoyaltyCheckoutIntent = {
    id: intent.id,
    clientIntentId: intent.id,
    kind: intent.kind,
    status: "pending",
    createdAt: intent.createdAt,
    rewardSlug: intent.rewardSlug ?? null,
    rewardName: intent.rewardName ?? null,
    pointsCost: intent.pointsCost ?? null,
    quantity: intent.quantity ?? null,
    referralCode: intent.referralCode ?? null,
    channel: intent.channel ?? null,
    expiresAt: intent.expiresAt ?? null,
    resolvedAt: null,
    metadata: intent.metadata ?? {}
  };

  return {
    clientIntentId: normalized.clientIntentId,
    serverId: null,
    intent: normalized,
    orderId: record.orderId ?? null,
    seenOnSuccess: record.seenOnSuccess,
    seenOnLoyalty: record.seenOnLoyalty
  };
}

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `loyalty-intent-${now()}`;
}

function normalizeDraft(draft: CheckoutIntentDraft): LoyaltyCheckoutIntent {
  const clientIntentId = generateId();
  const createdAt = new Date().toISOString();
  return {
    id: clientIntentId,
    clientIntentId,
    kind: draft.kind,
    status: "pending",
    createdAt,
    orderId: null,
    channel: draft.channel ?? null,
    rewardSlug: draft.rewardSlug ?? null,
    rewardName: draft.rewardName ?? null,
    pointsCost: draft.pointsCost ?? null,
    quantity: draft.quantity ?? null,
    referralCode: draft.referralCode ?? null,
    expiresAt: draft.expiresAt ?? null,
    resolvedAt: null,
    metadata: draft.metadata ? { ...draft.metadata } : {}
  };
}

function upsert(records: StoredIntentRecord[]): void {
  writeStorage(records.filter((record) => record.intent));
}

export function queueCheckoutIntents(drafts: CheckoutIntentDraft[]): LoyaltyCheckoutIntent[] {
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return [];
  }

  const normalized = drafts.map((draft) => normalizeDraft(draft));
  const existing = readStorage();
  const merged: StoredIntentRecord[] = [
    ...existing,
    ...normalized.map((intent) => ({
      clientIntentId: intent.clientIntentId,
      serverId: null,
      intent,
      orderId: null,
      seenOnSuccess: false,
      seenOnLoyalty: false
    }))
  ];
  writeStorage(merged);
  return normalized;
}

function hydrateIntent(record: StoredIntentRecord, orderId: string | null): LoyaltyCheckoutIntent {
  const intent = { ...record.intent };
  const metadata = intent.metadata ? { ...intent.metadata } : {};
  metadata.orderId = orderId ?? record.orderId ?? null;
  intent.metadata = metadata;
  intent.orderId = orderId ?? record.orderId ?? null;
  return intent;
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
      const intentWithOrder = hydrateIntent(record, orderId);
      intents.push(intentWithOrder);
      updated.push({
        ...record,
        intent: intentWithOrder,
        orderId: orderId ?? record.orderId ?? null,
        seenOnSuccess: true
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

function buildNextAction(intent: LoyaltyCheckoutIntent): LoyaltyNextActionCard {
  const metadata = intent.metadata ?? {};
  const cardMetadata = { ...metadata };
  cardMetadata.clientIntentId = intent.clientIntentId;

  if (intent.kind === "redemption") {
    const rewardName = intent.rewardName ?? intent.rewardSlug ?? "Reward";
    const points = typeof intent.pointsCost === "number" ? intent.pointsCost : null;
    const headline = rewardName;
    const description = points
      ? `Hold ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(points)} points and finish fulfillment in the loyalty hub.`
      : "Finalize your planned redemption in the loyalty hub.";
    cardMetadata.ctaHref = "/account/loyalty#rewards";
    return {
      id: intent.id,
      kind: intent.kind,
      headline,
      description,
      ctaLabel: "Open rewards",
      createdAt: intent.createdAt,
      expiresAt: intent.expiresAt ?? null,
      metadata: cardMetadata
    };
  }

  const referralCode = intent.referralCode ?? "your referral";
  cardMetadata.ctaHref = "/account/loyalty/referrals";
  return {
    id: intent.id,
    kind: intent.kind,
    headline: "Referral follow-up",
    description: `Send a thank-you or check in on ${referralCode} from the loyalty hub.`,
    ctaLabel: "Manage referrals",
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt ?? null,
    metadata: cardMetadata
  };
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
    } else {
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
    if (record.intent.status !== "pending") {
      return false;
    }
    const createdAt = Date.parse(record.intent.createdAt ?? "");
    return Number.isNaN(createdAt) ? false : createdAt >= now() - TTL_MS;
  });

  writeStorage(filtered);
}

export function persistServerFeed(feed: LoyaltyNextActionFeed): void {
  const existing = readStorage();
  const byServerId = new Map(existing.filter((item) => item.serverId).map((item) => [item.serverId as string, item]));
  const byClientId = new Map(existing.map((item) => [item.clientIntentId, item]));

  const nextRecords: StoredIntentRecord[] = feed.intents.map((intent) => {
    const serverId = intent.id;
    const match = byServerId.get(serverId) ?? byClientId.get(intent.clientIntentId);
    const baseRecord: StoredIntentRecord = match
      ? { ...match }
      : {
          clientIntentId: intent.clientIntentId,
          serverId: serverId,
          intent: intent,
          orderId: intent.orderId ?? null,
          seenOnSuccess: false,
          seenOnLoyalty: false
        };
    baseRecord.serverId = serverId;
    baseRecord.intent = intent;
    baseRecord.orderId = intent.orderId ?? baseRecord.orderId ?? null;
    return baseRecord;
  });

  writeStorage(nextRecords);
}
