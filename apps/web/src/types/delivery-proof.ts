export type DeliveryProofSnapshot = {
  metrics: Record<string, unknown>;
  recordedAt: string | null;
  source: string | null;
  warnings: string[];
};

export type DeliveryProofAccount = {
  id: string | null;
  handle: string | null;
  platform: string | null;
  displayName: string | null;
  verificationStatus: string | null;
  lastVerifiedAt: string | null;
  metadata: Record<string, unknown>;
};

export type DeliveryProofItem = {
  itemId: string;
  productTitle: string;
  platformContext: Record<string, unknown> | null;
  account: DeliveryProofAccount | null;
  baseline: DeliveryProofSnapshot | null;
  latest: DeliveryProofSnapshot | null;
  history: DeliveryProofSnapshot[];
};

export type OrderDeliveryProof = {
  orderId: string;
  generatedAt: string;
  items: DeliveryProofItem[];
};

export type DeliveryProofMetricAggregate = {
  metricId: string;
  metricKey: string;
  metricLabel?: string | null;
  unit?: string | null;
  sampleSize: number;
  baselineAverage?: number | null;
  latestAverage?: number | null;
  deltaAverage?: number | null;
  deltaPercent?: number | null;
  formattedDelta?: string | null;
  formattedLatest?: string | null;
  formattedPercent?: string | null;
};

export type DeliveryProofProductAggregate = {
  productId: string;
  productSlug?: string | null;
  productTitle?: string | null;
  sampleSize: number;
  platforms: string[];
  lastSnapshotAt?: string | null;
  metrics: DeliveryProofMetricAggregate[];
};

export type DeliveryProofAggregateResponse = {
  generatedAt: string;
  windowDays: number;
  products: DeliveryProofProductAggregate[];
};
