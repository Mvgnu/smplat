import type {
  ProviderServiceMetadata,
  FulfillmentProviderRuleMetadata as SharedFulfillmentProviderRuleMetadata,
  FulfillmentProviderRuleMetadataMap as SharedFulfillmentProviderRuleMetadataMap,
} from "@smplat/types";

export type FulfillmentProviderRuleMetadata = SharedFulfillmentProviderRuleMetadata;
export type FulfillmentProviderRuleMetadataMap = SharedFulfillmentProviderRuleMetadataMap;

export type FulfillmentService = {
  id: string;
  providerId: string;
  name: string;
  action: string;
  category: string | null;
  defaultCurrency: string | null;
  status: "active" | "inactive";
  healthStatus: "unknown" | "healthy" | "degraded" | "offline";
  allowedRegions: string[];
  rateLimitPerMinute: number | null;
  metadata: ProviderServiceMetadata;
  credentials: Record<string, unknown> | null;
  lastHealthCheckAt: string | null;
  healthPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FulfillmentProvider = {
  id: string;
  name: string;
  description: string | null;
  baseUrl: string | null;
  status: "active" | "inactive";
  healthStatus: "unknown" | "healthy" | "degraded" | "offline";
  allowedRegions: string[];
  rateLimitPerMinute: number | null;
  metadata: Record<string, unknown>;
  credentials: Record<string, unknown> | null;
  lastHealthCheckAt: string | null;
  healthPayload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  services: FulfillmentService[];
  balanceSnapshot?: {
    amount?: number | null;
    currency?: string | null;
    retrievedAt?: string | null;
    payload?: Record<string, unknown> | null;
  } | null;
};

export type FulfillmentProviderOrderRefill = {
  id: string;
  amount?: number | null;
  currency?: string | null;
  performedAt: string;
  response?: Record<string, unknown> | null;
};

export type FulfillmentProviderOrderReplayEntry = {
  id: string;
  requestedAmount?: number | null;
  currency?: string | null;
  performedAt?: string | null;
  scheduledFor?: string | null;
  status: "executed" | "scheduled" | "failed";
  response?: Record<string, unknown> | null;
  ruleIds?: string[] | null;
  ruleMetadata?: FulfillmentProviderRuleMetadataMap | null;
};

export type FulfillmentProviderOrder = {
  id: string;
  providerId: string;
  providerName?: string | null;
  serviceId: string;
  serviceAction?: string | null;
  orderId: string;
  orderItemId: string;
  amount?: number | null;
  currency?: string | null;
  providerOrderId?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  refills: FulfillmentProviderOrderRefill[];
  replays: FulfillmentProviderOrderReplayEntry[];
  scheduledReplays: FulfillmentProviderOrderReplayEntry[];
};
