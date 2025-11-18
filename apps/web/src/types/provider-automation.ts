export type ProviderAutomationRunStatus = {
  ranAt: string;
  summary: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
};

export type ProviderAutomationStatus = {
  replay: ProviderAutomationRunStatus | null;
  alerts: ProviderAutomationRunStatus | null;
};

export type ProviderAutomationHistory = {
  replay: ProviderAutomationRunStatus[];
  alerts: ProviderAutomationRunStatus[];
};
