import type { ProviderAutomationTelemetry } from "@/lib/provider-service-insights";
import type { CartSelectionSnapshot } from "@/types/cart";

export type QuickOrderTelemetryContext = {
  productTitle: string;
  productId: string | null;
  platformLabel: string;
  platformHandle: string | null;
  platformType: string | null;
  platformContextId: string | null;
  followerBaseline: string;
  followerDelta: string;
  lastSnapshotRelative: string | null;
  providerTelemetry: ProviderAutomationTelemetry | null;
  selection: CartSelectionSnapshot | null;
};
