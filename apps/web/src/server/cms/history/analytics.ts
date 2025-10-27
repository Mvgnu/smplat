// meta: module: marketing-preview-history-analytics
// meta: feature: marketing-preview-cockpit

import { REMEDIATION_PLAYBOOKS } from "@/shared/marketing/remediation";

import type {
  MarketingPreviewHistoryAnalytics,
  MarketingPreviewHistoryEntry,
  MarketingPreviewRecommendation,
  MarketingPreviewRegressionVelocity,
  MarketingPreviewSeverityMomentum,
  MarketingPreviewTimeToGreenForecast,
  MarketingPreviewRemediationActionRecord
} from "./types";

const HOURS_IN_MS = 60 * 60 * 1000;

const toTimestamp = (value: string): number => {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? Number.NaN : timestamp;
};

const createRegressionVelocity = (
  entries: MarketingPreviewHistoryEntry[]
): MarketingPreviewRegressionVelocity => {
  const sorted = [...entries]
    .map((entry) => ({
      timestamp: toTimestamp(entry.generatedAt),
      diffDetectedRoutes: entry.aggregates.diffDetectedRoutes
    }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sorted.length < 2) {
    return {
      averagePerHour: 0,
      currentPerHour: 0,
      sampleSize: sorted.length,
      confidence: 0
    };
  }

  const velocities: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const elapsedHours = (current.timestamp - previous.timestamp) / HOURS_IN_MS;
    if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) {
      continue;
    }
    const velocity =
      (current.diffDetectedRoutes - previous.diffDetectedRoutes) / elapsedHours;
    velocities.push(velocity);
  }

  if (!velocities.length) {
    return {
      averagePerHour: 0,
      currentPerHour: 0,
      sampleSize: sorted.length,
      confidence: 0.1
    };
  }

  const sum = velocities.reduce((total, value) => total + value, 0);
  const averagePerHour = sum / velocities.length;
  const currentPerHour = velocities[velocities.length - 1];
  const dispersion = velocities.reduce((total, value) => total + Math.abs(value - averagePerHour), 0);
  const stability = velocities.length > 1 ? 1 - Math.min(dispersion / velocities.length / Math.max(Math.abs(averagePerHour), 1), 1) : 0.5;
  const confidence = Math.min(1, 0.35 + 0.15 * velocities.length + stability * 0.5);

  return {
    averagePerHour,
    currentPerHour,
    sampleSize: sorted.length,
    confidence
  };
};

const createSeverityMomentum = (
  entries: MarketingPreviewHistoryEntry[]
): MarketingPreviewSeverityMomentum => {
  type SeverityKey = keyof MarketingPreviewSeverityMomentum;
  const severityKeys: Array<SeverityKey> = ["info", "warning", "blocker"] as const;
  const sorted = [...entries]
    .map((entry) => ({
      timestamp: toTimestamp(entry.generatedAt),
      severityCounts: entry.notes?.severityCounts ?? { info: 0, warning: 0, blocker: 0 }
    }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sorted.length < 2) {
    return {
      info: 0,
      warning: 0,
      blocker: 0,
      overall: 0,
      sampleSize: sorted.length
    };
  }

  const totals: Record<SeverityKey, number[]> = {
    info: [],
    warning: [],
    blocker: []
  };

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const elapsedHours = (current.timestamp - previous.timestamp) / HOURS_IN_MS;
    if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) {
      continue;
    }
    for (const key of severityKeys) {
      const delta =
        (current.severityCounts[key] - previous.severityCounts[key]) / elapsedHours;
      totals[key].push(delta);
    }
  }

  const result: MarketingPreviewSeverityMomentum = {
    info: totals.info.length
      ? totals.info.reduce((total, value) => total + value, 0) / totals.info.length
      : 0,
    warning: totals.warning.length
      ? totals.warning.reduce((total, value) => total + value, 0) / totals.warning.length
      : 0,
    blocker: totals.blocker.length
      ? totals.blocker.reduce((total, value) => total + value, 0) / totals.blocker.length
      : 0,
    overall: 0,
    sampleSize: sorted.length
  };

  result.overall = (result.info + result.warning * 1.5 + result.blocker * 2.25) / 3.5;

  return result;
};

const createTimeToGreenForecast = (
  entries: MarketingPreviewHistoryEntry[]
): MarketingPreviewTimeToGreenForecast => {
  const points = [...entries]
    .map((entry) => ({
      timestamp: toTimestamp(entry.generatedAt),
      diffDetectedRoutes: entry.aggregates.diffDetectedRoutes
    }))
    .filter((entry) => Number.isFinite(entry.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  if (points.length < 2) {
    return {
      forecastAt: null,
      forecastHours: null,
      slopePerHour: null,
      confidence: 0,
      sampleSize: points.length
    };
  }

  const base = points[0]!.timestamp;
  const xs = points.map((point) => (point.timestamp - base) / HOURS_IN_MS);
  const ys = points.map((point) => point.diffDetectedRoutes);
  const meanX = xs.reduce((total, value) => total + value, 0) / xs.length;
  const meanY = ys.reduce((total, value) => total + value, 0) / ys.length;

  let numerator = 0;
  let denominator = 0;
  let totalSquared = 0;

  for (let index = 0; index < xs.length; index += 1) {
    const dx = xs[index]! - meanX;
    const dy = ys[index]! - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
    totalSquared += dy * dy;
  }

  if (denominator === 0) {
    return {
      forecastAt: null,
      forecastHours: null,
      slopePerHour: null,
      confidence: 0,
      sampleSize: points.length
    };
  }

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  if (slope >= 0) {
    return {
      forecastAt: null,
      forecastHours: null,
      slopePerHour: slope,
      confidence: 0.1,
      sampleSize: points.length
    };
  }

  const hoursToZero = -intercept / slope;
  const forecastTimestamp = base + hoursToZero * HOURS_IN_MS;
  const latestTimestamp = points[points.length - 1]!.timestamp;
  const forecastAt = forecastTimestamp > latestTimestamp ? new Date(forecastTimestamp).toISOString() : null;
  const ssr = points.reduce((total, point, index) => {
    const expected = slope * xs[index]! + intercept;
    const residual = point.diffDetectedRoutes - expected;
    return total + residual * residual;
  }, 0);
  const sst = totalSquared;
  const rSquared = sst === 0 ? 0 : 1 - ssr / sst;
  const confidence = Math.max(0, Math.min(1, rSquared));

  return {
    forecastAt,
    forecastHours: forecastAt ? hoursToZero : null,
    slopePerHour: slope,
    confidence,
    sampleSize: points.length
  };
};

const KNOWN_FINGERPRINT_SUGGESTIONS: Record<string, { suggestion: string }> = {
  "schema:missing-field": {
    suggestion: "Validate schema fields in Payload and replay the snapshot"
  },
  "lexical:normalization": {
    suggestion: "Normalize Lexical nodes before publishing the draft"
  },
  "fallback:stale": {
    suggestion: "Refresh fallback fixtures and reprioritize active payload"
  },
  "content-gap:cta": {
    suggestion: "Populate marketing copy for CTA blocks from campaign brief"
  }
};

const scoreRecommendations = (
  entries: MarketingPreviewHistoryEntry[]
): MarketingPreviewRecommendation[] => {
  const ledger = new Map<string, MarketingPreviewRecommendation>();

  const record = (
    fingerprint: string,
    remediation: MarketingPreviewRemediationActionRecord,
    routes: string[]
  ) => {
    const existing = ledger.get(fingerprint);
    const suggestion =
      KNOWN_FINGERPRINT_SUGGESTIONS[fingerprint]?.suggestion ??
      "Review remediation history and align with closest playbook";
    const affectedRoutes = new Set(existing?.affectedRoutes ?? []);
    for (const route of routes) {
      affectedRoutes.add(route);
    }
    const occurrences = (existing?.occurrences ?? 0) + 1;
    const confidence = Math.min(0.95, 0.35 + Math.log10(occurrences + 1));
    const lastSeenAt = remediation.recordedAt ?? existing?.lastSeenAt ?? null;

    ledger.set(fingerprint, {
      fingerprint,
      suggestion,
      occurrences,
      confidence,
      lastSeenAt,
      affectedRoutes: Array.from(affectedRoutes)
    });
  };

  for (const entry of entries) {
    const routes = entry.routes.map((route) => route.route);
    for (const remediation of entry.remediations) {
      if (!remediation.fingerprint) {
        continue;
      }
      record(remediation.fingerprint, remediation, routes);
    }
  }

  const ranked = Array.from(ledger.values());
  ranked.sort((a, b) => {
    if (b.occurrences === a.occurrences) {
      return (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "");
    }
    return b.occurrences - a.occurrences;
  });

  return ranked;
};

export const buildHistoryAnalytics = (
  entries: MarketingPreviewHistoryEntry[]
): MarketingPreviewHistoryAnalytics => {
  const regressionVelocity = createRegressionVelocity(entries);
  const severityMomentum = createSeverityMomentum(entries);
  const timeToGreen = createTimeToGreenForecast(entries);
  const recommendations = scoreRecommendations(entries);

  return {
    regressionVelocity,
    severityMomentum,
    timeToGreen,
    recommendations
  };
};

export const suggestRemediationPlaybooks = (
  fingerprint: string
): MarketingPreviewRecommendation["suggestion"] => {
  const suggestion = KNOWN_FINGERPRINT_SUGGESTIONS[fingerprint]?.suggestion;
  if (suggestion) {
    return suggestion;
  }

  const normalizedFingerprint = fingerprint.split(":")[0] ?? fingerprint;
  const playbook = REMEDIATION_PLAYBOOKS.find((candidate) =>
    candidate.id.includes(normalizedFingerprint)
  );
  if (playbook) {
    return playbook.summary;
  }
  return "Review remediation catalog for applicable guidance";
};
