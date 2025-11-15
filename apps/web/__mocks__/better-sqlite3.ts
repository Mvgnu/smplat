/* eslint-disable @typescript-eslint/no-explicit-any */

type ManifestRecord = {
  id: string;
  generatedAt: string;
  label: string | null;
  payload: string;
  payloadHash: string;
};

type RouteRecord = {
  route: string;
  routeHash: string;
  diffDetected: boolean;
  hasDraft: boolean;
  hasPublished: boolean;
  sectionCount: number;
  blockKinds: string;
  createdAt: string;
};

type GovernanceAction = {
  id: string;
  manifestId: string | null;
  actorHash: string | null;
  actionKind: string;
  metadata: string | null;
  createdAt: string;
};

type LiveDeltaRecord = {
  id: string;
  manifestGeneratedAt: string | null;
  generatedAt: string;
  route: string | null;
  variantKey: string | null;
  payload: string;
  payloadHash: string;
  recordedAt: string;
};

type RemediationActionRecord = {
  id: string;
  manifestGeneratedAt: string | null;
  route: string;
  action: "reset" | "prioritize";
  fingerprint: string | null;
  summary: string | null;
  collection: string | null;
  docId: string | null;
  payloadHash: string;
  recordedAt: string;
};

type NoteRevisionRecord = {
  id: string;
  noteId: string;
  manifestGeneratedAt: string;
  route: string;
  severity: string;
  body: string;
  authorHash: string | null;
  payloadHash: string;
  recordedAt: string;
};

type RehearsalActionRecord = {
  id: string;
  manifestGeneratedAt: string | null;
  scenarioFingerprint: string;
  expectedDeltas: number;
  operatorHash: string | null;
  payloadHash: string;
  recordedAt: string;
  verdict: string;
  actualDeltas: number | null;
  diff: number | null;
  failureReasons: string | null;
  comparisonPayload: string | null;
  evaluatedAt: string | null;
};

class Statement {
  private readonly sql: string;
  private readonly database: MockDatabase;

  constructor(database: MockDatabase, sql: string) {
    this.database = database;
    this.sql = sql.trim();
  }

  run(parameters?: any) {
    if (this.sql.startsWith("INSERT INTO snapshot_manifests")) {
      const payload = parameters as {
        id: string;
        generated_at: string;
        label: string | null;
        payload: string;
        payload_hash: string;
      };
      this.database.manifests.set(payload.id, {
        id: payload.id,
        generatedAt: payload.generated_at,
        label: payload.label ?? null,
        payload: payload.payload,
        payloadHash: payload.payload_hash
      });
      return { changes: 1 };
    }

    if (this.sql.startsWith("INSERT INTO snapshot_routes")) {
      const payload = parameters as {
        manifest_id: string;
        route: string;
        route_hash: string;
        diff_detected: number;
        has_draft: number;
        has_published: number;
        section_count: number;
        block_kinds: string;
        created_at: string;
      };
      const routes = this.database.ensureRoutes(payload.manifest_id);
      routes.set(payload.route_hash, {
        route: payload.route,
        routeHash: payload.route_hash,
        diffDetected: Boolean(payload.diff_detected),
        hasDraft: Boolean(payload.has_draft),
        hasPublished: Boolean(payload.has_published),
        sectionCount: payload.section_count,
        blockKinds: payload.block_kinds,
        createdAt: payload.created_at
      });
      return { changes: 1 };
    }

    if (this.sql.startsWith("DELETE FROM snapshot_routes")) {
      const manifestId = Array.isArray(parameters) ? parameters[0] : parameters;
      this.database.routes.delete(manifestId);
      return { changes: 1 };
    }

    if (this.sql.startsWith("DELETE FROM snapshot_manifests")) {
      const manifestId = Array.isArray(parameters) ? parameters[0] : parameters;
      const manifest = this.database.manifests.get(manifestId);
      this.database.manifests.delete(manifestId);
      this.database.routes.delete(manifestId);
      this.database.governance.delete(manifestId);
      if (manifest) {
        this.database.deleteArtifactsForManifest(manifest.generatedAt);
      }
      return { changes: 1 };
    }

    if (this.sql.startsWith("INSERT OR REPLACE INTO governance_actions")) {
      const payload = parameters as {
        id: string;
        manifest_id: string | null;
        actor_hash: string | null;
        action_kind: string;
        metadata: string | null;
        created_at: string;
      };
      const existing = this.database.ensureGovernance(payload.manifest_id ?? "");
      const index = existing.findIndex((entry) => entry.id === payload.id);
      const record: GovernanceAction = {
        id: payload.id,
        manifestId: payload.manifest_id,
        actorHash: payload.actor_hash,
        actionKind: payload.action_kind,
        metadata: payload.metadata,
        createdAt: payload.created_at
      };
      if (index >= 0) {
        existing[index] = record;
      } else {
        existing.push(record);
      }
      return { changes: 1 };
    }

    if (this.sql.startsWith("INSERT INTO live_preview_deltas")) {
      const payload = parameters as {
        id: string;
        manifest_generated_at: string | null;
        generated_at: string;
        route: string | null;
        variant_key: string | null;
        payload: string;
        payload_hash: string;
        recorded_at: string;
      };
      const records = this.database.ensureLiveDeltas(payload.manifest_generated_at ?? null);
      if (records.has(payload.payload_hash)) {
        return { changes: 0 };
      }
      records.set(payload.payload_hash, {
        id: payload.id,
        manifestGeneratedAt: payload.manifest_generated_at ?? null,
        generatedAt: payload.generated_at,
        route: payload.route ?? null,
        variantKey: payload.variant_key ?? null,
        payload: payload.payload,
        payloadHash: payload.payload_hash,
        recordedAt: payload.recorded_at
      });
      return { changes: 1 };
    }

    if (this.sql.startsWith("DELETE FROM live_preview_deltas")) {
      const manifestGeneratedAt = Array.isArray(parameters) ? parameters[0] : parameters;
      this.database.liveDeltas.delete(this.database.toKey(manifestGeneratedAt));
      return { changes: 1 };
    }

    if (this.sql.startsWith("INSERT INTO remediation_actions")) {
      const payload = parameters as {
        id: string;
        manifest_generated_at: string | null;
        route: string;
        action: "reset" | "prioritize";
        fingerprint: string | null;
        summary: string | null;
        collection: string | null;
        doc_id: string | null;
        payload_hash: string;
        recorded_at: string;
      };
      const records = this.database.ensureRemediationActions(payload.manifest_generated_at ?? null);
      if (records.has(payload.payload_hash)) {
        return { changes: 0 };
      }
      records.set(payload.payload_hash, {
        id: payload.id,
        manifestGeneratedAt: payload.manifest_generated_at ?? null,
        route: payload.route,
        action: payload.action,
        fingerprint: payload.fingerprint ?? null,
        summary: payload.summary ?? null,
        collection: payload.collection ?? null,
        docId: payload.doc_id ?? null,
        payloadHash: payload.payload_hash,
        recordedAt: payload.recorded_at
      });
      return { changes: 1 };
    }

    if (this.sql.startsWith("DELETE FROM remediation_actions")) {
      const manifestGeneratedAt = Array.isArray(parameters) ? parameters[0] : parameters;
      this.database.remediationActions.delete(this.database.toKey(manifestGeneratedAt));
      return { changes: 1 };
    }

    if (this.sql.startsWith("INSERT INTO note_revisions")) {
      const payload = parameters as {
        id: string;
        note_id: string;
        manifest_generated_at: string;
        route: string;
        severity: string;
        body: string;
        author_hash: string | null;
        payload_hash: string;
        recorded_at: string;
      };
      const records = this.database.ensureNoteRevisions(payload.manifest_generated_at);
      if (records.has(payload.payload_hash)) {
        return { changes: 0 };
      }
      records.set(payload.payload_hash, {
        id: payload.id,
        noteId: payload.note_id,
        manifestGeneratedAt: payload.manifest_generated_at,
        route: payload.route,
        severity: payload.severity,
        body: payload.body,
        authorHash: payload.author_hash ?? null,
        payloadHash: payload.payload_hash,
        recordedAt: payload.recorded_at
      });
      return { changes: 1 };
    }

    if (this.sql.startsWith("DELETE FROM note_revisions")) {
      const manifestGeneratedAt = Array.isArray(parameters) ? parameters[0] : parameters;
      this.database.noteRevisions.delete(this.database.toKey(manifestGeneratedAt));
      return { changes: 1 };
    }

    if (this.sql.startsWith("INSERT INTO rehearsal_actions")) {
      const payload = parameters as {
        id: string;
        manifest_generated_at: string | null;
        scenario_fingerprint: string;
        expected_deltas: number;
        operator_hash: string | null;
        payload_hash: string;
        recorded_at: string;
        verdict: string | null;
        actual_deltas: number | null;
        diff: number | null;
        failure_reasons: string | null;
        comparison_payload: string | null;
        evaluated_at: string | null;
      };
      this.database.upsertRehearsalAction(payload);
      return { changes: 1 };
    }

    if (this.sql.startsWith("DELETE FROM rehearsal_actions")) {
      const manifestGeneratedAt = Array.isArray(parameters) ? parameters[0] : parameters;
      this.database.deleteRehearsalActionsByManifest(manifestGeneratedAt ?? null);
      return { changes: 1 };
    }

    throw new Error(`Unsupported run statement: ${this.sql}`);
  }

  all(parameters?: any) {
    if (this.sql.startsWith("PRAGMA table_info")) {
      const match = this.sql.match(/PRAGMA\s+table_info\(([^)]+)\)/i);
      const table = match?.[1]?.trim();
      if (!table) {
        return [];
      }
      return this.database.getTableColumns(table).map((name) => ({ name }));
    }

    if (this.sql.startsWith("SELECT id, manifest_generated_at, scenario_fingerprint")) {
      const manifestGeneratedAt = Array.isArray(parameters) ? parameters[0] : parameters;
      return this.database.getRehearsalActions(manifestGeneratedAt ?? null).map((action) => ({
        id: action.id,
        manifest_generated_at: action.manifestGeneratedAt,
        scenario_fingerprint: action.scenarioFingerprint,
        expected_deltas: action.expectedDeltas,
        operator_hash: action.operatorHash,
        payload_hash: action.payloadHash,
        recorded_at: action.recordedAt,
        verdict: action.verdict,
        actual_deltas: action.actualDeltas,
        diff: action.diff,
        failure_reasons: action.failureReasons,
        comparison_payload: action.comparisonPayload,
        evaluated_at: action.evaluatedAt,
      }));
    }

    if (
      this.sql.startsWith("SELECT id FROM snapshot_manifests") ||
      this.sql.startsWith("SELECT id, generated_at FROM snapshot_manifests")
    ) {
      const offset = Array.isArray(parameters) ? parameters[0] : Number(parameters ?? 0);
      const manifests = this.database.sortedManifests().slice(offset);
      const includeGeneratedAt = this.sql.includes("generated_at");
      return manifests.map((entry) =>
        includeGeneratedAt ? { id: entry.id, generated_at: entry.generatedAt } : { id: entry.id }
      );
    }

    if (this.sql.startsWith("SELECT payload FROM snapshot_manifests")) {
      const limit = Array.isArray(parameters) ? parameters[0] : Number(parameters ?? 0);
      return this.database
        .sortedManifests()
        .slice(0, limit)
        .map((entry) => ({ payload: entry.payload }));
    }

    if (this.sql.startsWith("SELECT route, route_hash, diff_detected")) {
      const manifestId = Array.isArray(parameters) ? parameters[0] : parameters;
      return this.database.getRoutes(manifestId).map((route) => ({
        route: route.route,
        route_hash: route.routeHash,
        diff_detected: Number(route.diffDetected),
        has_draft: Number(route.hasDraft),
        has_published: Number(route.hasPublished),
        section_count: route.sectionCount,
        block_kinds: route.blockKinds
      }));
    }

    if (this.sql.startsWith("SELECT action_kind, COUNT(*)")) {
      const manifestId = Array.isArray(parameters) ? parameters[0] : parameters;
      const actions = this.database.ensureGovernance(manifestId ?? "");
      const grouped = new Map<string, { count: number; lastCreatedAt: string | null }>();
      for (const action of actions) {
        const entry = grouped.get(action.actionKind) ?? { count: 0, lastCreatedAt: null };
        entry.count += 1;
        if (!entry.lastCreatedAt || action.createdAt > entry.lastCreatedAt) {
          entry.lastCreatedAt = action.createdAt;
        }
        grouped.set(action.actionKind, entry);
      }
      return Array.from(grouped.entries()).map(([actionKind, details]) => ({
        action_kind: actionKind,
        count: details.count,
        last_created_at: details.lastCreatedAt
      }));
    }

    if (this.sql.startsWith("SELECT id, manifest_generated_at, generated_at")) {
      const manifestGeneratedAt = Array.isArray(parameters) ? parameters[0] : parameters;
      return this.database.getLiveDeltas(manifestGeneratedAt).map((record) => ({
        id: record.id,
        manifest_generated_at: record.manifestGeneratedAt,
        generated_at: record.generatedAt,
        route: record.route,
        variant_key: record.variantKey,
        payload: record.payload,
        payload_hash: record.payloadHash,
        recorded_at: record.recordedAt
      }));
    }

    if (this.sql.startsWith("SELECT id, manifest_generated_at, route, action")) {
      const manifestGeneratedAt = Array.isArray(parameters) ? parameters[0] : parameters;
      return this.database.getRemediationActions(manifestGeneratedAt).map((record) => ({
        id: record.id,
        manifest_generated_at: record.manifestGeneratedAt,
        route: record.route,
        action: record.action,
        fingerprint: record.fingerprint,
        summary: record.summary,
        collection: record.collection,
        doc_id: record.docId,
        payload_hash: record.payloadHash,
        recorded_at: record.recordedAt
      }));
    }

    if (this.sql.startsWith("SELECT id, note_id, manifest_generated_at")) {
      const manifestGeneratedAt = Array.isArray(parameters) ? parameters[0] : parameters;
      return this.database.getNoteRevisions(manifestGeneratedAt).map((record) => ({
        id: record.id,
        note_id: record.noteId,
        manifest_generated_at: record.manifestGeneratedAt,
        route: record.route,
        severity: record.severity,
        body: record.body,
        author_hash: record.authorHash,
        payload_hash: record.payloadHash,
        recorded_at: record.recordedAt
      }));
    }

    if (this.sql.startsWith("SELECT sm.id")) {
      const params = parameters ?? {};
      const limit = Number(params.limit ?? 10);
      const offset = Number(params.offset ?? 0);
      const routeFilter = params.route as string | undefined;
      const routeHash = params.route_hash as string | undefined;
      const requireDraft = this.sql.includes("sr_draft.has_draft = 1");
      const requirePublished = this.sql.includes("sr_published.has_published = 1");

      const filtered = this.database.sortedManifests().filter((manifest) => {
        const manifestRoutes = this.database.getRoutes(manifest.id);
        if (!manifestRoutes.length) {
          return false;
        }

        const matchesRoute = (() => {
          if (!routeFilter && !routeHash) {
            return true;
          }
          return manifestRoutes.some(
            (route) =>
              route.route === routeFilter || (routeHash && route.routeHash === routeHash)
          );
        })();

        if (!matchesRoute) {
          return false;
        }

        const relevantRoutes = routeFilter || routeHash
          ? manifestRoutes.filter(
              (route) =>
                route.route === routeFilter || (routeHash && route.routeHash === routeHash)
            )
          : manifestRoutes;

        if (requireDraft && !relevantRoutes.some((route) => route.hasDraft)) {
          return false;
        }

        if (requirePublished && !relevantRoutes.some((route) => route.hasPublished)) {
          return false;
        }

        return true;
      });

      const paginated = filtered.slice(offset, offset + limit);

      return paginated.map((manifest) => {
        const manifestRoutes = this.database.getRoutes(manifest.id);
        const totals = this.database.computeAggregates(manifestRoutes);
        return {
          id: manifest.id,
          generated_at: manifest.generatedAt,
          label: manifest.label,
          payload: manifest.payload,
          total_routes: totals.totalRoutes,
          diff_routes: totals.diffDetectedRoutes,
          draft_routes: totals.draftRoutes,
          published_routes: totals.publishedRoutes
        };
      });
    }

    if (this.sql.startsWith("SELECT COUNT(*) as count FROM snapshot_manifests")) {
      const params = parameters ?? {};
      const routeFilter = params.route as string | undefined;
      const routeHash = params.route_hash as string | undefined;
      const requireDraft = this.sql.includes("sr_draft.has_draft = 1");
      const requirePublished = this.sql.includes("sr_published.has_published = 1");

      const count = this.database.sortedManifests().filter((manifest) => {
        const manifestRoutes = this.database.getRoutes(manifest.id);
        if (!manifestRoutes.length) {
          return false;
        }
        const matchesRoute = (() => {
          if (!routeFilter && !routeHash) {
            return true;
          }
          return manifestRoutes.some(
            (route) =>
              route.route === routeFilter || (routeHash && route.routeHash === routeHash)
          );
        })();
        if (!matchesRoute) {
          return false;
        }
        const relevantRoutes = routeFilter || routeHash
          ? manifestRoutes.filter(
              (route) =>
                route.route === routeFilter || (routeHash && route.routeHash === routeHash)
            )
          : manifestRoutes;
        if (requireDraft && !relevantRoutes.some((route) => route.hasDraft)) {
          return false;
        }
        if (requirePublished && !relevantRoutes.some((route) => route.hasPublished)) {
          return false;
        }
        return true;
      }).length;

      return [{ count }];
    }

    throw new Error(`Unsupported all statement: ${this.sql}`);
  }

  get(parameters?: any) {
    if (this.sql.startsWith("SELECT route, route_hash FROM snapshot_routes")) {
      const manifestId = Array.isArray(parameters) ? parameters[0] : parameters;
      const [first] = this.database.getRoutes(manifestId);
      if (!first) {
        return undefined;
      }
      return {
        route: first.route,
        route_hash: first.routeHash
      };
    }

    if (this.sql.startsWith("SELECT COUNT(*) as count")) {
      const [result] = this.all(parameters) as Array<{ count: number }>;
      return result ?? { count: 0 };
    }

    if (this.sql.startsWith("SELECT id, manifest_generated_at, scenario_fingerprint")) {
      const actionId = Array.isArray(parameters) ? parameters[0] : parameters;
      const record = this.database.getRehearsalActionById(actionId);
      if (!record) {
        return undefined;
      }
      return {
        id: record.id,
        manifest_generated_at: record.manifestGeneratedAt,
        scenario_fingerprint: record.scenarioFingerprint,
        expected_deltas: record.expectedDeltas,
        operator_hash: record.operatorHash,
        payload_hash: record.payloadHash,
        recorded_at: record.recordedAt,
        verdict: record.verdict,
        actual_deltas: record.actualDeltas,
        diff: record.diff,
        failure_reasons: record.failureReasons,
        comparison_payload: record.comparisonPayload,
        evaluated_at: record.evaluatedAt,
      };
    }

    throw new Error(`Unsupported get statement: ${this.sql}`);
  }
}

class MockDatabase {
  manifests = new Map<string, ManifestRecord>();
  routes = new Map<string, Map<string, RouteRecord>>();
  governance = new Map<string, GovernanceAction[]>();
  liveDeltas = new Map<string, Map<string, LiveDeltaRecord>>();
  remediationActions = new Map<string, Map<string, RemediationActionRecord>>();
  noteRevisions = new Map<string, Map<string, NoteRevisionRecord>>();
  rehearsalActionsById = new Map<string, RehearsalActionRecord>();
  rehearsalActionsByHash = new Map<string, RehearsalActionRecord>();
  private tableColumns = new Map<string, Set<string>>();

  constructor(_file: string) {}

  pragma(_statement: string) {
    return undefined;
  }

  exec(statement: string) {
    const trimmed = statement.trim();

    const rehearsalMatch = trimmed.match(/CREATE TABLE IF NOT EXISTS\s+rehearsal_actions\s*\(([\s\S]*?)\);/i);
    if (rehearsalMatch) {
      const columns = rehearsalMatch[1]
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry && !entry.toUpperCase().startsWith("PRIMARY KEY"))
        .map((entry) => entry.split(/\s+/)[0]);
      if (columns.length) {
        this.recordTableColumns("rehearsal_actions", columns);
      }
    }

    const alterMatch = trimmed.match(/ALTER TABLE\s+([A-Za-z0-9_]+)\s+ADD COLUMN\s+([A-Za-z0-9_]+)/i);
    if (alterMatch) {
      const [, table, column] = alterMatch;
      this.ensureTableColumns(table).add(column);
    }

    return undefined;
  }

  prepare(sql: string) {
    return new Statement(this, sql);
  }

  transaction<T>(handler: (...args: any[]) => T) {
    return (...args: any[]) => handler(...args);
  }

  close() {
    this.manifests.clear();
    this.routes.clear();
    this.governance.clear();
    this.liveDeltas.clear();
    this.remediationActions.clear();
    this.noteRevisions.clear();
    this.rehearsalActionsById.clear();
    this.rehearsalActionsByHash.clear();
  }

  toKey(value: string | null | undefined) {
    return value ?? "__null__";
  }

  ensureRoutes(manifestId: string) {
    if (!this.routes.has(manifestId)) {
      this.routes.set(manifestId, new Map());
    }
    return this.routes.get(manifestId)!;
  }

  ensureGovernance(manifestId: string) {
    const key = manifestId ?? "";
    if (!this.governance.has(key)) {
      this.governance.set(key, []);
    }
    return this.governance.get(key)!;
  }

  ensureLiveDeltas(manifestGeneratedAt: string | null | undefined) {
    const key = this.toKey(manifestGeneratedAt);
    if (!this.liveDeltas.has(key)) {
      this.liveDeltas.set(key, new Map());
    }
    return this.liveDeltas.get(key)!;
  }

  ensureRemediationActions(manifestGeneratedAt: string | null | undefined) {
    const key = this.toKey(manifestGeneratedAt);
    if (!this.remediationActions.has(key)) {
      this.remediationActions.set(key, new Map());
    }
    return this.remediationActions.get(key)!;
  }

  ensureNoteRevisions(manifestGeneratedAt: string) {
    const key = this.toKey(manifestGeneratedAt);
    if (!this.noteRevisions.has(key)) {
      this.noteRevisions.set(key, new Map());
    }
    return this.noteRevisions.get(key)!;
  }

  getRoutes(manifestId: string) {
    const routes = this.routes.get(manifestId);
    if (!routes) {
      return [] as RouteRecord[];
    }
    return Array.from(routes.values()).sort((a, b) => a.route.localeCompare(b.route));
  }

  getLiveDeltas(manifestGeneratedAt: string) {
    const records = this.liveDeltas.get(this.toKey(manifestGeneratedAt));
    if (!records) {
      return [] as LiveDeltaRecord[];
    }
    return Array.from(records.values()).sort((a, b) =>
      a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0
    );
  }

  getRemediationActions(manifestGeneratedAt: string) {
    const records = this.remediationActions.get(this.toKey(manifestGeneratedAt));
    if (!records) {
      return [] as RemediationActionRecord[];
    }
    return Array.from(records.values()).sort((a, b) =>
      a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0
    );
  }

  getNoteRevisions(manifestGeneratedAt: string) {
    const records = this.noteRevisions.get(this.toKey(manifestGeneratedAt));
    if (!records) {
      return [] as NoteRevisionRecord[];
    }
    return Array.from(records.values()).sort((a, b) =>
      a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0
    );
  }

  deleteArtifactsForManifest(manifestGeneratedAt: string) {
    const key = this.toKey(manifestGeneratedAt);
    this.liveDeltas.delete(key);
    this.remediationActions.delete(key);
    this.noteRevisions.delete(key);
    this.deleteRehearsalActionsByManifest(manifestGeneratedAt);
  }

  sortedManifests() {
    return Array.from(this.manifests.values()).sort((a, b) =>
      a.generatedAt < b.generatedAt ? 1 : a.generatedAt > b.generatedAt ? -1 : 0
    );
  }

  computeAggregates(routes: RouteRecord[]) {
    let diffDetectedRoutes = 0;
    let draftRoutes = 0;
    let publishedRoutes = 0;
    for (const route of routes) {
      if (route.diffDetected) {
        diffDetectedRoutes += 1;
      }
      if (route.hasDraft) {
        draftRoutes += 1;
      }
      if (route.hasPublished) {
        publishedRoutes += 1;
      }
    }
    return {
      totalRoutes: routes.length,
      diffDetectedRoutes,
      draftRoutes,
      publishedRoutes
    };
  }

  getTableColumns(table?: string) {
    if (!table) {
      return [];
    }
    return Array.from(this.ensureTableColumns(table));
  }

  recordTableColumns(table: string, columns: string[]) {
    const set = this.ensureTableColumns(table);
    columns.forEach((column) => {
      if (column) {
        set.add(column);
      }
    });
  }

  ensureTableColumns(table: string) {
    if (!this.tableColumns.has(table)) {
      this.tableColumns.set(table, new Set());
    }
    return this.tableColumns.get(table)!;
  }

  upsertRehearsalAction(payload: {
    id: string;
    manifest_generated_at: string | null;
    scenario_fingerprint: string;
    expected_deltas: number;
    operator_hash: string | null;
    payload_hash: string;
    recorded_at: string;
    verdict: string | null;
    actual_deltas: number | null;
    diff: number | null;
    failure_reasons: string | null;
    comparison_payload: string | null;
    evaluated_at: string | null;
  }) {
    const existing = this.rehearsalActionsByHash.get(payload.payload_hash);
    const record: RehearsalActionRecord = existing
      ? {
          ...existing,
          manifestGeneratedAt: payload.manifest_generated_at ?? existing.manifestGeneratedAt,
          scenarioFingerprint: payload.scenario_fingerprint ?? existing.scenarioFingerprint,
          expectedDeltas: payload.expected_deltas ?? existing.expectedDeltas,
          operatorHash: payload.operator_hash ?? existing.operatorHash,
          recordedAt: payload.recorded_at ?? existing.recordedAt,
          verdict: payload.verdict ?? existing.verdict,
          actualDeltas: payload.actual_deltas ?? existing.actualDeltas,
          diff: payload.diff ?? existing.diff,
          failureReasons: payload.failure_reasons ?? existing.failureReasons,
          comparisonPayload: payload.comparison_payload ?? existing.comparisonPayload,
          evaluatedAt: payload.evaluated_at ?? existing.evaluatedAt,
        }
      : {
          id: payload.id,
          manifestGeneratedAt: payload.manifest_generated_at,
          scenarioFingerprint: payload.scenario_fingerprint,
          expectedDeltas: payload.expected_deltas,
          operatorHash: payload.operator_hash,
          payloadHash: payload.payload_hash,
          recordedAt: payload.recorded_at,
          verdict: payload.verdict ?? "pending",
          actualDeltas: payload.actual_deltas ?? null,
          diff: payload.diff ?? null,
          failureReasons: payload.failure_reasons ?? null,
          comparisonPayload: payload.comparison_payload ?? null,
          evaluatedAt: payload.evaluated_at ?? null,
        };

    this.rehearsalActionsByHash.set(record.payloadHash, record);
    this.rehearsalActionsById.set(record.id, record);
  }

  deleteRehearsalActionsByManifest(manifestGeneratedAt: string | null) {
    const key = manifestGeneratedAt ?? null;
    for (const record of Array.from(this.rehearsalActionsByHash.values())) {
      if (record.manifestGeneratedAt === key) {
        this.rehearsalActionsByHash.delete(record.payloadHash);
        this.rehearsalActionsById.delete(record.id);
      }
    }
  }

  getRehearsalActions(manifestGeneratedAt: string | null) {
    return Array.from(this.rehearsalActionsByHash.values())
      .filter((record) => record.manifestGeneratedAt === manifestGeneratedAt)
      .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0));
  }

  getRehearsalActionById(id: string) {
    return this.rehearsalActionsById.get(id);
  }
}

export type Database = MockDatabase;

export default MockDatabase;
