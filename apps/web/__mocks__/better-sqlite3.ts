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
      this.database.manifests.delete(manifestId);
      this.database.routes.delete(manifestId);
      this.database.governance.delete(manifestId);
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

    throw new Error(`Unsupported run statement: ${this.sql}`);
  }

  all(parameters?: any) {
    if (this.sql.startsWith("SELECT id FROM snapshot_manifests")) {
      const offset = Array.isArray(parameters) ? parameters[0] : Number(parameters ?? 0);
      const ids = this.database
        .sortedManifests()
        .slice(offset)
        .map((entry) => ({ id: entry.id }));
      return ids;
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

    throw new Error(`Unsupported get statement: ${this.sql}`);
  }
}

class MockDatabase {
  manifests = new Map<string, ManifestRecord>();
  routes = new Map<string, Map<string, RouteRecord>>();
  governance = new Map<string, GovernanceAction[]>();

  constructor(_file: string) {}

  pragma(_statement: string) {
    return undefined;
  }

  exec(_statement: string) {
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

  getRoutes(manifestId: string) {
    const routes = this.routes.get(manifestId);
    if (!routes) {
      return [] as RouteRecord[];
    }
    return Array.from(routes.values()).sort((a, b) => a.route.localeCompare(b.route));
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
}

export type Database = MockDatabase;

export default MockDatabase;
