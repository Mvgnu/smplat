import { Buffer } from "node:buffer";

import type {
  LoyaltyLedgerEntry,
  LoyaltyRedemption,
  LoyaltyTimelineCursor,
  LoyaltyTimelineEntry,
  LoyaltyTimelineFilters,
  LoyaltyTimelinePage,
  ReferralConversion
} from "@smplat/types";

import {
  fetchLoyaltyLedger as fetchLoyaltyLedgerData,
  fetchLoyaltyRedemptions as fetchLoyaltyRedemptionsData,
  fetchReferralConversions as fetchReferralConversionsData
} from "@/app/(storefront)/account/loyalty/data";

export type LoyaltyTimelineFetchers = {
  fetchLoyaltyLedger: typeof fetchLoyaltyLedgerData;
  fetchLoyaltyRedemptions: typeof fetchLoyaltyRedemptionsData;
  fetchReferralConversions: typeof fetchReferralConversionsData;
};

let fetchers: LoyaltyTimelineFetchers = {
  fetchLoyaltyLedger: fetchLoyaltyLedgerData,
  fetchLoyaltyRedemptions: fetchLoyaltyRedemptionsData,
  fetchReferralConversions: fetchReferralConversionsData
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
    fetchReferralConversions: fetchReferralConversionsData
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

type TimelineSourceKind = "ledger" | "redemption" | "referral";

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
    includeReferrals: filters?.includeReferrals ?? true
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

function compareTimelineEntries(a: LoyaltyTimelineEntry, b: LoyaltyTimelineEntry): number {
  const left = new Date(pickTimestamp(a)).getTime();
  const right = new Date(pickTimestamp(b)).getTime();
  return right - left;
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
      const currentEntry = state.kind === "ledger"
        ? toLedgerTimelineEntry(candidate)
        : state.kind === "redemption"
          ? toRedemptionTimelineEntry(candidate)
          : toReferralTimelineEntry(candidate);
      const chosenEntry =
        chosen.state.kind === "ledger"
          ? toLedgerTimelineEntry(chosen.entry)
          : chosen.state.kind === "redemption"
            ? toRedemptionTimelineEntry(chosen.entry)
            : toReferralTimelineEntry(chosen.entry);
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

    let timelineEntry: LoyaltyTimelineEntry;
    if (state.kind === "ledger") {
      timelineEntry = toLedgerTimelineEntry(entry);
      state.lastConsumedCursor = encodeTimeUuidCursor(entry.occurredAt, entry.id);
    } else if (state.kind === "redemption") {
      timelineEntry = toRedemptionTimelineEntry(entry);
      state.lastConsumedCursor = encodeTimeUuidCursor(entry.requestedAt, entry.id);
    } else {
      timelineEntry = toReferralTimelineEntry(entry);
      const timestamp = timelineEntry.occurredAt;
      state.lastConsumedCursor = encodeTimeUuidCursor(timestamp, entry.id);
    }

    entries.push(timelineEntry);
  }

  const ledgerCursorState = states.find((state) => state.kind === "ledger");
  const redemptionCursorState = states.find((state) => state.kind === "redemption");
  const referralCursorState = states.find((state) => state.kind === "referral");

  const cursorPayload: LoyaltyTimelineCursor = {
    ledger: filters.includeLedger ? ledgerCursorState?.nextCursor ?? null : null,
    redemptions: filters.includeRedemptions ? redemptionCursorState?.nextCursor ?? null : null,
    referrals: filters.includeReferrals ? referralCursorState?.nextCursor ?? null : null
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
