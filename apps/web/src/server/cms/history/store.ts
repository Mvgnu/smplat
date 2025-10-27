import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import DatabaseConstructor, { type Database } from "better-sqlite3";

import type { MarketingPreviewSnapshotManifest, MarketingPreviewTimelineRouteSummary } from "../preview/types";
import type {
  MarketingPreviewGovernanceStats,
  MarketingPreviewHistoryAggregates,
  MarketingPreviewHistoryEntry,
  MarketingPreviewHistoryQuery,
  MarketingPreviewHistoryQueryResult,
  MarketingPreviewHistoryRouteRecord
} from "./types";

const DATABASE_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  ".data/marketing-preview-history.sqlite"
);

let db: Database | null = null;

const ensureDirectory = () => {
  fs.mkdirSync(path.dirname(DATABASE_FILE), { recursive: true });
};

const openDatabase = (): Database => {
  if (db) {
    return db;
  }

  ensureDirectory();
  db = new DatabaseConstructor(DATABASE_FILE);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshot_manifests (
      id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      label TEXT,
      payload TEXT NOT NULL,
      payload_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshot_routes (
      manifest_id TEXT NOT NULL,
      route TEXT NOT NULL,
      route_hash TEXT NOT NULL,
      diff_detected INTEGER NOT NULL,
      has_draft INTEGER NOT NULL,
      has_published INTEGER NOT NULL,
      section_count INTEGER NOT NULL,
      block_kinds TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (manifest_id, route_hash),
      FOREIGN KEY (manifest_id) REFERENCES snapshot_manifests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS governance_actions (
      id TEXT PRIMARY KEY,
      manifest_id TEXT,
      actor_hash TEXT,
      action_kind TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (manifest_id) REFERENCES snapshot_manifests(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshot_manifests_generated_at ON snapshot_manifests(generated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_snapshot_routes_manifest ON snapshot_routes(manifest_id);
    CREATE INDEX IF NOT EXISTS idx_governance_actions_manifest ON governance_actions(manifest_id);
  `);

  return db;
};

const toBooleanFlag = (value: boolean) => (value ? 1 : 0);

const hash = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

const DEFAULT_QUERY_LIMIT = 10;
const MAX_QUERY_LIMIT = 50;

export const persistSnapshotManifest = (
  manifest: MarketingPreviewSnapshotManifest,
  routeSummaries: MarketingPreviewTimelineRouteSummary[],
  historyLimit = 24
) => {
  const database = openDatabase();
  const manifestId = manifest.label ?? manifest.generatedAt;
  const payload = JSON.stringify(manifest);
  const payloadHash = hash(payload);

  const insertManifest = database.prepare(`
    INSERT INTO snapshot_manifests (id, generated_at, label, payload, payload_hash)
    VALUES (@id, @generated_at, @label, @payload, @payload_hash)
    ON CONFLICT(id) DO UPDATE SET
      generated_at = excluded.generated_at,
      label = excluded.label,
      payload = excluded.payload,
      payload_hash = excluded.payload_hash;
  `);

  const insertRoute = database.prepare(`
    INSERT INTO snapshot_routes (
      manifest_id,
      route,
      route_hash,
      diff_detected,
      has_draft,
      has_published,
      section_count,
      block_kinds,
      created_at
    )
    VALUES (@manifest_id, @route, @route_hash, @diff_detected, @has_draft, @has_published, @section_count, @block_kinds, @created_at)
    ON CONFLICT(manifest_id, route_hash) DO UPDATE SET
      diff_detected = excluded.diff_detected,
      has_draft = excluded.has_draft,
      has_published = excluded.has_published,
      section_count = excluded.section_count,
      block_kinds = excluded.block_kinds,
      created_at = excluded.created_at;
  `);

  const deleteRoutes = database.prepare(`
    DELETE FROM snapshot_routes WHERE manifest_id = ?;
  `);

  const deleteManifest = database.prepare(`
    DELETE FROM snapshot_manifests WHERE id = ?;
  `);

  database.transaction(() => {
    insertManifest.run({
      id: manifestId,
      generated_at: manifest.generatedAt,
      label: manifest.label ?? null,
      payload,
      payload_hash: payloadHash
    });

    deleteRoutes.run(manifestId);

    for (const summary of routeSummaries) {
      insertRoute.run({
        manifest_id: manifestId,
        route: summary.route,
        route_hash: hash(summary.route),
        diff_detected: toBooleanFlag(summary.diffDetected),
        has_draft: toBooleanFlag(summary.hasDraft),
        has_published: toBooleanFlag(summary.hasPublished),
        section_count: summary.sectionCount,
        block_kinds: JSON.stringify(summary.blockKinds),
        created_at: manifest.generatedAt
      });
    }

    const stale = database
      .prepare(
        `SELECT id FROM snapshot_manifests ORDER BY datetime(generated_at) DESC LIMIT -1 OFFSET ?`
      )
      .all(historyLimit);

    for (const row of stale) {
      deleteRoutes.run(row.id);
      deleteManifest.run(row.id);
    }
  })();
};

export const fetchSnapshotHistory = (
  limit = 8
): MarketingPreviewSnapshotManifest[] => {
  const database = openDatabase();
  const rows = database
    .prepare(
      `SELECT payload FROM snapshot_manifests ORDER BY datetime(generated_at) DESC LIMIT ?`
    )
    .all(limit);

  return rows
    .map((row) => {
      try {
        return JSON.parse(row.payload) as MarketingPreviewSnapshotManifest;
      } catch (error) {
        throw new Error("Failed to parse snapshot manifest payload", { cause: error });
      }
    })
    .filter((entry) => Boolean(entry?.generatedAt && entry?.snapshots));
};

export const recordGovernanceAction = (
  action: {
    id: string;
    manifestId?: string;
    actorHash?: string;
    actionKind: string;
    metadata?: Record<string, unknown>;
    createdAt?: string;
  }
) => {
  const database = openDatabase();
  const insertAction = database.prepare(`
    INSERT OR REPLACE INTO governance_actions (
      id,
      manifest_id,
      actor_hash,
      action_kind,
      metadata,
      created_at
    )
    VALUES (@id, @manifest_id, @actor_hash, @action_kind, @metadata, @created_at);
  `);

  insertAction.run({
    id: action.id,
    manifest_id: action.manifestId ?? null,
    actor_hash: action.actorHash ?? null,
    action_kind: action.actionKind,
    metadata: action.metadata ? JSON.stringify(action.metadata) : null,
    created_at: action.createdAt ?? new Date().toISOString()
  });
};

const fetchRoutesForManifest = (manifestId: string, database: Database): MarketingPreviewHistoryRouteRecord[] => {
  const rows = database
    .prepare<unknown[]>(
      `SELECT route, route_hash, diff_detected, has_draft, has_published, section_count, block_kinds
       FROM snapshot_routes
       WHERE manifest_id = ?
       ORDER BY route ASC`
    )
    .all(manifestId) as Array<{
      route: string;
      route_hash: string;
      diff_detected: number;
      has_draft: number;
      has_published: number;
      section_count: number;
      block_kinds: string;
    }>;

  return rows.map((row) => ({
    route: row.route,
    routeHash: row.route_hash,
    diffDetected: Boolean(row.diff_detected),
    hasDraft: Boolean(row.has_draft),
    hasPublished: Boolean(row.has_published),
    sectionCount: row.section_count,
    blockKinds: (() => {
      try {
        const parsed = JSON.parse(row.block_kinds) as unknown;
        return Array.isArray(parsed) ? (parsed as string[]) : [];
      } catch (error) {
        throw new Error("Failed to parse stored block kinds", { cause: error });
      }
    })()
  }));
};

const fetchGovernanceStats = (manifestId: string, database: Database): MarketingPreviewGovernanceStats => {
  const rows = database
    .prepare<unknown[]>(
      `SELECT action_kind, COUNT(*) as count, MAX(created_at) as last_created_at
       FROM governance_actions
       WHERE manifest_id = ?
       GROUP BY action_kind`
    )
    .all(manifestId) as Array<{ action_kind: string; count: number; last_created_at: string | null }>;

  const actionsByKind: Record<string, number> = {};
  let total = 0;
  let lastActionAt: string | null = null;

  for (const row of rows) {
    actionsByKind[row.action_kind] = row.count;
    total += row.count;
    if (row.last_created_at && (!lastActionAt || row.last_created_at > lastActionAt)) {
      lastActionAt = row.last_created_at;
    }
  }

  return {
    totalActions: total,
    actionsByKind,
    lastActionAt
  };
};

const parseManifestPayload = (payload: string): MarketingPreviewSnapshotManifest => {
  try {
    return JSON.parse(payload) as MarketingPreviewSnapshotManifest;
  } catch (error) {
    throw new Error("Failed to parse snapshot manifest payload", { cause: error });
  }
};

const toAggregates = (row: {
  total_routes: number | null;
  diff_routes: number | null;
  draft_routes: number | null;
  published_routes: number | null;
}): MarketingPreviewHistoryAggregates => ({
  totalRoutes: row.total_routes ?? 0,
  diffDetectedRoutes: row.diff_routes ?? 0,
  draftRoutes: row.draft_routes ?? 0,
  publishedRoutes: row.published_routes ?? 0
});

const buildHistoryEntry = (
  row: {
    id: string;
    generated_at: string;
    label: string | null;
    payload: string;
    total_routes: number | null;
    diff_routes: number | null;
    draft_routes: number | null;
    published_routes: number | null;
  },
  database: Database
): MarketingPreviewHistoryEntry => {
  const routes = fetchRoutesForManifest(row.id, database);
  const governance = fetchGovernanceStats(row.id, database);
  return {
    id: row.id,
    generatedAt: row.generated_at,
    label: row.label,
    manifest: parseManifestPayload(row.payload),
    routes,
    aggregates: toAggregates(row),
    governance
  };
};

const buildFilters = (query: MarketingPreviewHistoryQuery) => {
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (query.route) {
    params.route = query.route;
    params.route_hash = hash(query.route);
    where.push(`EXISTS (SELECT 1 FROM snapshot_routes sr_filter
      WHERE sr_filter.manifest_id = sm.id
        AND (sr_filter.route = @route OR sr_filter.route_hash = @route_hash))`);
  }

  if (query.variant === "draft") {
    where.push(`EXISTS (SELECT 1 FROM snapshot_routes sr_draft
      WHERE sr_draft.manifest_id = sm.id AND sr_draft.has_draft = 1${query.route ? " AND (sr_draft.route = @route OR sr_draft.route_hash = @route_hash)" : ""})`);
  }

  if (query.variant === "published") {
    where.push(`EXISTS (SELECT 1 FROM snapshot_routes sr_published
      WHERE sr_published.manifest_id = sm.id AND sr_published.has_published = 1${query.route ? " AND (sr_published.route = @route OR sr_published.route_hash = @route_hash)" : ""})`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  return { whereClause, params };
};

export const querySnapshotHistory = (
  query: MarketingPreviewHistoryQuery = {}
): MarketingPreviewHistoryQueryResult => {
  const database = openDatabase();
  const limit = clamp(query.limit ?? DEFAULT_QUERY_LIMIT, 1, MAX_QUERY_LIMIT);
  const offset = Math.max(query.offset ?? 0, 0);
  const { whereClause, params } = buildFilters(query);

  const rows = database
    .prepare(
      `SELECT sm.id, sm.generated_at, sm.label, sm.payload,
        COUNT(sr.route) as total_routes,
        SUM(CASE WHEN sr.diff_detected = 1 THEN 1 ELSE 0 END) as diff_routes,
        SUM(CASE WHEN sr.has_draft = 1 THEN 1 ELSE 0 END) as draft_routes,
        SUM(CASE WHEN sr.has_published = 1 THEN 1 ELSE 0 END) as published_routes
      FROM snapshot_manifests sm
      LEFT JOIN snapshot_routes sr ON sr.manifest_id = sm.id
      ${whereClause}
      GROUP BY sm.id
      ORDER BY datetime(sm.generated_at) DESC
      LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset }) as Array<{
      id: string;
      generated_at: string;
      label: string | null;
      payload: string;
      total_routes: number | null;
      diff_routes: number | null;
      draft_routes: number | null;
      published_routes: number | null;
    }>;

  const totalRow = database
    .prepare(`SELECT COUNT(*) as count FROM snapshot_manifests sm ${whereClause}`)
    .get(params) as { count: number };

  return {
    total: totalRow?.count ?? 0,
    limit,
    offset,
    entries: rows.map((row) => buildHistoryEntry(row, database))
  };
};

export const createHistoryHash = (value: string): string => hash(value);

export const resetHistoryStore = () => {
  if (db) {
    db.close();
    db = null;
  }
  if (fs.existsSync(DATABASE_FILE)) {
    fs.rmSync(DATABASE_FILE);
  }
};

export const __internal = {
  get databaseFile() {
    return DATABASE_FILE;
  },
  openDatabase
};
