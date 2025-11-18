"use client";

import type { QuickOrderTelemetryContext } from "@/types/quick-order";

const STORAGE_KEY = "smplat.quickOrder.sessions";
const MAX_SESSIONS = 5;
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

type QuickOrderSessionRecord = {
  id: string;
  createdAt: string;
  expiresAt: string;
  source: string;
  context: QuickOrderTelemetryContext;
};

const nowIso = () => new Date().toISOString();

const readSessionMap = (): Record<string, QuickOrderSessionRecord> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, QuickOrderSessionRecord>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const persistSessionMap = (sessions: Record<string, QuickOrderSessionRecord>) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // ignore storage failures
  }
};

const pruneSessions = (sessions: Record<string, QuickOrderSessionRecord>): Record<string, QuickOrderSessionRecord> => {
  const entries = Object.entries(sessions).filter(([, record]) => {
    if (!record?.expiresAt) {
      return true;
    }
    const expires = Date.parse(record.expiresAt);
    return Number.isNaN(expires) ? true : Date.now() < expires;
  });
  entries.sort(([, a], [, b]) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return Object.fromEntries(entries.slice(0, MAX_SESSIONS));
};

export type QuickOrderSessionSnapshot = QuickOrderSessionRecord;

export function startQuickOrderSession(options: {
  context: QuickOrderTelemetryContext;
  source?: string;
  ttlMs?: number;
}): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const sessionId = crypto.randomUUID();
  const createdAt = nowIso();
  const ttl = Number.isFinite(options.ttlMs) && options.ttlMs && options.ttlMs > 0 ? options.ttlMs : DEFAULT_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const map = pruneSessions(readSessionMap());
  map[sessionId] = {
    id: sessionId,
    createdAt,
    expiresAt,
    source: options.source ?? "account-orders",
    context: options.context,
  };
  persistSessionMap(map);
  return sessionId;
}

export function consumeQuickOrderSession(sessionId: string | null | undefined): QuickOrderSessionSnapshot | null {
  if (!sessionId || typeof window === "undefined") {
    return null;
  }
  const map = pruneSessions(readSessionMap());
  const record = map[sessionId] ?? null;
  if (record) {
    delete map[sessionId];
    persistSessionMap(map);
    return record;
  }
  persistSessionMap(map);
  return null;
}

export function peekQuickOrderSession(sessionId: string | null | undefined): QuickOrderSessionSnapshot | null {
  if (!sessionId || typeof window === "undefined") {
    return null;
  }
  const map = pruneSessions(readSessionMap());
  const record = map[sessionId] ?? null;
  persistSessionMap(map);
  return record ?? null;
}
