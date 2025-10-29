import { Buffer } from "node:buffer";

import type {
  LoyaltyGuardrailOverride,
  LoyaltyGuardrailSnapshot,
  LoyaltyLedgerEntry,
  LoyaltyNudgeCard,
  LoyaltyNudgeFeed,
  LoyaltyRedemption,
  LoyaltyTimelineCursor,
  LoyaltyTimelineEntry,
  LoyaltyTimelineFilters,
  LoyaltyTimelinePage,
  ReferralConversion
} from "@smplat/types";

import {
  fetchLoyaltyLedger as fetchLoyaltyLedgerData,
  fetchLoyaltyNudgeHistory as fetchLoyaltyNudgeHistoryData,
  fetchLoyaltyRedemptions as fetchLoyaltyRedemptionsData,
  fetchReferralConversions as fetchReferralConversionsData
} from "@/app/(storefront)/account/loyalty/data";
import { fetchGuardrailSnapshot } from "@/server/loyalty/guardrails";

export type LoyaltyTimelineFetchers = {
  fetchLoyaltyLedger: typeof fetchLoyaltyLedgerData;
  fetchLoyaltyRedemptions: typeof fetchLoyaltyRedemptionsData;
  fetchReferralConversions: typeof fetchReferralConversionsData;
  fetchLoyaltyNudgeHistory: typeof fetchLoyaltyNudgeHistoryData;
  fetchGuardrailSnapshot: typeof fetchGuardrailSnapshot;
};

let fetchers: LoyaltyTimelineFetchers = {
  fetchLoyaltyLedger: fetchLoyaltyLedgerData,
  fetchLoyaltyRedemptions: fetchLoyaltyRedemptionsData,
  fetchReferralConversions: fetchReferralConversionsData,
  fetchLoyaltyNudgeHistory: fetchLoyaltyNudgeHistoryData,
  fetchGuardrailSnapshot
};

export function configureLoyaltyTimelineFetchers(
  overrides: Partial<LoyaltyTimelineFetchers>
): void {
  fetchers = { ...fetchers, ...overrides };
}

export function resetLoyaltyTimelineFetchers(): void {
  fetchers = {
    fetchLoyaltyLedger: fetchLoyaltyLedgerData,
    fetchLoyaltyRedemptions: fetchLoyaltyRedemptionsData,
    fetchReferralConversions: fetchReferralConversionsData,
    fetchLoyaltyNudgeHistory: fetchLoyaltyNudgeHistoryData,
    fetchGuardrailSnapshot
  };
}

const DEFAULT_LIMIT = 20;
const BASE64_ENCODING = "base64url" as const;

function encodeTimeUuidCursor(timestamp: string, id: string): string {
  return Buffer.from(`${timestamp}|${id}`).toString(BASE64_ENCODING);
}

function decodeTimelineCursorToken(cursor?: string | null): LoyaltyTimelineCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const raw = Buffer.from(cursor, BASE64_ENCODING).toString("utf-8");
    return JSON.parse(raw) as LoyaltyTimelineCursor;
  } catch (error) {
    console.warn("Failed to decode loyalty timeline cursor", error);
    return null;
  }
}

export function encodeTimelineCursor(cursor: LoyaltyTimelineCursor | null): string | null {
  if (!cursor) {
    return null;
  }

  return Buffer.from(JSON.stringify(cursor)).toString(BASE64_ENCODING);
}

export function decodeTimelineCursor(
  cursor?: string | null
): LoyaltyTimelineCursor | null {
  return decodeTimelineCursorToken(cursor);
}

type TimelineSourceKind = "ledger" | "redemption" | "referral" | "nudge" | "guardrail";

type TimelineSourceState<T> = {
  kind: TimelineSourceKind;
  entries: T[];
  consumed: number;
  nextCursor: string | null;
  lastConsumedCursor: string | null;
};

type NormalizedTimelineFilters = {
  ledgerTypes: string[] | null;
  redemptionStatuses: string[] | null;
  referralStatuses: string[] | null;
  includeLedger: boolean;
  includeRedemptions: boolean;
  includeReferrals: boolean;
  includeNudges: boolean;
  includeGuardrails: boolean;
  nudgeStatuses: string[] | null;
  guardrailScopes: string[] | null;
  referralCode: string | null;
  campaignSlug: string | null;
  checkoutOrderId: string | null;
};

function normalizeFilters(filters?: LoyaltyTimelineFilters): NormalizedTimelineFilters {
  const ledgerTypes = filters?.ledgerTypes;
  const redemptionStatuses = filters?.redemptionStatuses;
  const referralStatuses = filters?.referralStatuses;
  return {
    ledgerTypes: filters?.includeLedger === false ? [] : ledgerTypes ?? null,
    redemptionStatuses: filters?.redemptionStatuses ?? null,
    referralStatuses: filters?.referralStatuses ?? null,
    includeLedger: filters?.includeLedger ?? true,
    includeRedemptions: filters?.includeRedemptions ?? true,
    includeReferrals: filters?.includeReferrals ?? true,
    includeNudges: filters?.includeNudges ?? true,
    includeGuardrails: filters?.includeGuardrails ?? true,
    nudgeStatuses: filters?.nudgeStatuses ?? null,
    guardrailScopes: filters?.guardrailScopes ?? null,
    referralCode: filters?.referralCode?.toLowerCase() ?? null,
    campaignSlug: filters?.campaignSlug?.toLowerCase() ?? null,
    checkoutOrderId: filters?.checkoutOrderId?.toLowerCase() ?? null
  };
}

function pickTimestamp(entry: LoyaltyTimelineEntry): string {
  switch (entry.kind) {
    case "ledger":
      return entry.ledger.occurredAt;
    case "redemption":
      return entry.redemption.requestedAt;
    case "referral":
      return entry.referral.completedAt ?? entry.referral.updatedAt ?? entry.referral.createdAt;
    case "nudge":
      return pickNudgeTimestamp(entry.nudge);
    case "guardrail_override":
      return entry.override.createdAt;
    default:
      return new Date().toISOString();
  }
}

function toLedgerTimelineEntry(entry: LoyaltyLedgerEntry): LoyaltyTimelineEntry {
  return {
    kind: "ledger",
    id: entry.id,
    occurredAt: entry.occurredAt,
    ledger: entry
  };
}

function toRedemptionTimelineEntry(entry: LoyaltyRedemption): LoyaltyTimelineEntry {
  return {
    kind: "redemption",
    id: entry.id,
    occurredAt: entry.requestedAt,
    redemption: entry
  };
}

function toReferralTimelineEntry(entry: ReferralConversion): LoyaltyTimelineEntry {
  return {
    kind: "referral",
    id: entry.id,
    occurredAt: entry.completedAt ?? entry.updatedAt ?? entry.createdAt,
    referral: entry
  };
}

function pickNudgeTimestamp(nudge: LoyaltyNudgeCard): string {
  return (
    nudge.acknowledgedAt ??
    nudge.dismissedAt ??
    nudge.lastTriggeredAt ??
    nudge.expiresAt ??
    new Date().toISOString()
  );
}

function toNudgeTimelineEntry(entry: LoyaltyNudgeCard): LoyaltyTimelineEntry {
  return {
    kind: "nudge",
    id: entry.id,
    occurredAt: pickNudgeTimestamp(entry),
    nudge: entry
  };
}

function toGuardrailTimelineEntry(entry: LoyaltyGuardrailOverride): LoyaltyTimelineEntry {
  return {
    kind: "guardrail_override",
    id: entry.id,
    occurredAt: entry.createdAt,
    override: entry
  };
}

function compareTimelineEntries(a: LoyaltyTimelineEntry, b: LoyaltyTimelineEntry): number {
  const left = new Date(pickTimestamp(a)).getTime();
  const right = new Date(pickTimestamp(b)).getTime();
  return right - left;
}

function resolveTimelineEntry(
  state: TimelineSourceState<any>,
  entry: any
): LoyaltyTimelineEntry {
  switch (state.kind) {
    case "ledger":
      return toLedgerTimelineEntry(entry);
    case "redemption":
      return toRedemptionTimelineEntry(entry);
    case "referral":
      return toReferralTimelineEntry(entry);
    case "nudge":
      return toNudgeTimelineEntry(entry as LoyaltyNudgeCard);
    case "guardrail":
    default:
      return toGuardrailTimelineEntry(entry as LoyaltyGuardrailOverride);
  }
}

function resolveCursorInput(cursor?: LoyaltyTimelineCursor | string | null): LoyaltyTimelineCursor | null {
  if (!cursor) {
    return null;
  }

  if (typeof cursor === "string") {
    return decodeTimelineCursorToken(cursor);
  }

  return cursor;
}

function matchesAdvancedFilters(
  entry: LoyaltyTimelineEntry,
  filters: NormalizedTimelineFilters
): boolean {
  if (filters.referralCode) {
    const target = filters.referralCode;
    if (entry.kind === "referral") {
      return entry.referral.code?.toLowerCase().includes(target) ?? false;
    }
    if (entry.kind === "ledger") {
      const metadata = entry.ledger.metadata ?? {};
      const referralMetadata =
        (metadata.referral_code as string | undefined) ||
        (metadata.referralCode as string | undefined);
      if (!referralMetadata) {
        return false;
      }
      return referralMetadata.toLowerCase().includes(target);
    }
    return false;
  }

  if (filters.campaignSlug) {
    if (entry.kind !== "nudge") {
      return false;
    }
    return (entry.nudge.campaignSlug ?? "").toLowerCase().includes(filters.campaignSlug);
  }

  if (filters.checkoutOrderId) {
    const target = filters.checkoutOrderId;
    if (entry.kind === "ledger") {
      const orderId =
        entry.ledger.checkoutOrderId ??
        (entry.ledger.metadata.order_id as string | undefined) ??
        (entry.ledger.metadata.orderId as string | undefined);
      if (!orderId) {
        return false;
      }
      return orderId.toLowerCase().includes(target);
    }
    if (entry.kind === "nudge") {
      const nudgeOrder =
        (entry.nudge.metadata.orderId as string | undefined) ??
        (entry.nudge.metadata.checkoutIntentId as string | undefined);
      if (!nudgeOrder) {
        return false;
      }
      return nudgeOrder.toLowerCase().includes(target);
    }
    return false;
  }

  return true;
}

async function refillLedgerState(
  state: TimelineSourceState<LoyaltyLedgerEntry>,
  filters: NormalizedTimelineFilters,
  cursor: string | null,
  limit: number
): Promise<void> {
  const response = await fetchers.fetchLoyaltyLedger({
    cursor: cursor ?? undefined,
    limit,
    types: filters.ledgerTypes ?? undefined
  });
  state.entries.push(...response.entries);
  state.nextCursor = response.nextCursor ?? null;
}

async function refillRedemptionState(
  state: TimelineSourceState<LoyaltyRedemption>,
  filters: NormalizedTimelineFilters,
  cursor: string | null,
  limit: number
): Promise<void> {
  const response = await fetchers.fetchLoyaltyRedemptions({
    cursor: cursor ?? undefined,
    limit,
    statuses: filters.redemptionStatuses ?? undefined
  });
  state.entries.push(...response.redemptions);
  state.nextCursor = response.nextCursor ?? null;
}

async function refillReferralState(
  state: TimelineSourceState<ReferralConversion>,
  filters: NormalizedTimelineFilters,
  cursor: string | null,
  limit: number
): Promise<void> {
  const statuses = filters.referralStatuses ?? ["converted", "sent", "expired", "cancelled"];

  const response = await fetchers.fetchReferralConversions({
    cursor: cursor ?? undefined,
    limit,
    statuses
  });
  state.entries.push(...response.invites);
  state.nextCursor = response.nextCursor ?? null;
}

async function hydrateNudgeState(
  state: TimelineSourceState<LoyaltyNudgeCard>,
  filters: NormalizedTimelineFilters,
  limit: number
): Promise<void> {
  const response: LoyaltyNudgeFeed = await fetchers.fetchLoyaltyNudgeHistory();
  const statuses = filters.nudgeStatuses?.map((status) => status.toLowerCase());
  const filtered = response.nudges.filter((nudge) => {
    if (!statuses || statuses.length === 0) {
      return true;
    }
    return statuses.includes(nudge.status.toLowerCase());
  });
  state.entries.push(...filtered.slice(0, limit * 3));
  state.nextCursor = null;
}

async function hydrateGuardrailState(
  state: TimelineSourceState<LoyaltyGuardrailOverride>,
  filters: NormalizedTimelineFilters
): Promise<void> {
  const snapshot: LoyaltyGuardrailSnapshot = await fetchers.fetchGuardrailSnapshot();
  const scopes = filters.guardrailScopes?.map((scope) => scope.toLowerCase());
  const overrides = snapshot.overrides ?? [];
  const filtered = overrides.filter((override) => {
    if (!scopes || scopes.length === 0) {
      return true;
    }
    return scopes.includes(override.scope.toLowerCase());
  });
  state.entries.push(...filtered);
  state.nextCursor = null;
}

export type FetchLoyaltyTimelineOptions = {
  limit?: number;
  filters?: LoyaltyTimelineFilters;
  cursor?: string | LoyaltyTimelineCursor | null;
};

export type LoyaltyTimelineResult = LoyaltyTimelinePage & {
  cursorToken: string | null;
};

export async function fetchLoyaltyTimeline(
  options: FetchLoyaltyTimelineOptions = {}
): Promise<LoyaltyTimelineResult> {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 50));
  const filters = normalizeFilters(options.filters);
  const cursor = resolveCursorInput(options.cursor);

  const states: TimelineSourceState<any>[] = [];

  if (filters.includeLedger) {
    const ledgerState: TimelineSourceState<LoyaltyLedgerEntry> = {
      kind: "ledger",
      entries: [],
      consumed: 0,
      nextCursor: null,
      lastConsumedCursor: cursor?.ledger ?? null
    };
    await refillLedgerState(ledgerState, filters, cursor?.ledger ?? null, limit);
    states.push(ledgerState);
  }

  if (filters.includeRedemptions) {
    const redemptionState: TimelineSourceState<LoyaltyRedemption> = {
      kind: "redemption",
      entries: [],
      consumed: 0,
      nextCursor: null,
      lastConsumedCursor: cursor?.redemptions ?? null
    };
    await refillRedemptionState(redemptionState, filters, cursor?.redemptions ?? null, limit);
    states.push(redemptionState);
  }

  if (filters.includeReferrals) {
    const referralState: TimelineSourceState<ReferralConversion> = {
      kind: "referral",
      entries: [],
      consumed: 0,
      nextCursor: null,
      lastConsumedCursor: cursor?.referrals ?? null
    };
    await refillReferralState(referralState, filters, cursor?.referrals ?? null, limit);
    states.push(referralState);
  }

  if (filters.includeNudges) {
    const nudgeState: TimelineSourceState<LoyaltyNudgeCard> = {
      kind: "nudge",
      entries: [],
      consumed: 0,
      nextCursor: null,
      lastConsumedCursor: cursor?.nudges ?? null
    };
    await hydrateNudgeState(nudgeState, filters, limit);
    if (nudgeState.entries.length > 0) {
      states.push(nudgeState);
    }
  }

  if (filters.includeGuardrails) {
    const guardrailState: TimelineSourceState<LoyaltyGuardrailOverride> = {
      kind: "guardrail",
      entries: [],
      consumed: 0,
      nextCursor: null,
      lastConsumedCursor: cursor?.guardrails ?? null
    };
    await hydrateGuardrailState(guardrailState, filters);
    if (guardrailState.entries.length > 0) {
      states.push(guardrailState);
    }
  }

  const entries: LoyaltyTimelineEntry[] = [];

  const getNextCandidate = (): { state: TimelineSourceState<any>; entry: any } | null => {
    let chosen: { state: TimelineSourceState<any>; entry: any } | null = null;
    for (const state of states) {
      const candidate = state.entries[state.consumed];
      if (!candidate) {
        continue;
      }
      if (!chosen) {
        chosen = { state, entry: candidate };
        continue;
      }
      const currentEntry = resolveTimelineEntry(state, candidate);
      const chosenEntry = resolveTimelineEntry(chosen.state, chosen.entry);
      if (compareTimelineEntries(currentEntry, chosenEntry) >= 0) {
        continue;
      }
      chosen = { state, entry: candidate };
    }
    return chosen;
  };

  while (entries.length < limit) {
    const candidate = getNextCandidate();
    if (!candidate) {
      const refillable = states.find((state) => state.entries.length === state.consumed && state.nextCursor);
      if (!refillable || !refillable.nextCursor) {
        break;
      }
      if (refillable.kind === "ledger") {
        await refillLedgerState(refillable, filters, refillable.nextCursor, limit);
      } else if (refillable.kind === "redemption") {
        await refillRedemptionState(refillable, filters, refillable.nextCursor, limit);
      } else {
        await refillReferralState(refillable, filters, refillable.nextCursor, limit);
      }
      continue;
    }

    const { state, entry } = candidate;
    state.consumed += 1;

    const timelineEntry = resolveTimelineEntry(state, entry);
    state.lastConsumedCursor = encodeTimeUuidCursor(timelineEntry.occurredAt, timelineEntry.id);

    if (!matchesAdvancedFilters(timelineEntry, filters)) {
      continue;
    }

    entries.push(timelineEntry);
  }

  const ledgerCursorState = states.find((state) => state.kind === "ledger");
  const redemptionCursorState = states.find((state) => state.kind === "redemption");
  const referralCursorState = states.find((state) => state.kind === "referral");
  const nudgeCursorState = states.find((state) => state.kind === "nudge");
  const guardrailCursorState = states.find((state) => state.kind === "guardrail");

  const cursorPayload: LoyaltyTimelineCursor = {
    ledger: filters.includeLedger ? ledgerCursorState?.nextCursor ?? null : null,
    redemptions: filters.includeRedemptions ? redemptionCursorState?.nextCursor ?? null : null,
    referrals: filters.includeReferrals ? referralCursorState?.nextCursor ?? null : null,
    nudges: filters.includeNudges ? nudgeCursorState?.nextCursor ?? null : null,
    guardrails: filters.includeGuardrails ? guardrailCursorState?.nextCursor ?? null : null
  };

  const hasMore = states.some((state) => {
    const remaining = state.entries.length - state.consumed;
    if (remaining > 0) {
      return true;
    }
    return Boolean(state.nextCursor);
  });

  return {
    entries,
    cursor: cursorPayload,
    cursorToken: encodeTimelineCursor(cursorPayload),
    hasMore,
    appliedFilters: filters
  };
}
