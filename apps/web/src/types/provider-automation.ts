export type ProviderAutomationRunStatus = {
  ranAt: string;
  summary: Record<string, unknown>;
};

export type ProviderAutomationStatus = {
  replay: ProviderAutomationRunStatus | null;
  alerts: ProviderAutomationRunStatus | null;
};

export type ProviderAutomationHistory = {
  replay: ProviderAutomationRunStatus[];
  alerts: ProviderAutomationRunStatus[];
};
