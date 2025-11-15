export type JourneyComponentStage =
  | "preset"
  | "checkout"
  | "post_checkout"
  | "operator"
  | "automation"
  | (string & {});

export type JourneyComponentEvent =
  | "cta_launch"
  | "preset_apply"
  | "checkout_step"
  | "automation_tick"
  | (string & {});

export type JourneyComponentTrigger = {
  stage: JourneyComponentStage;
  event: JourneyComponentEvent;
  channel?: string | null;
  presetId?: string | null;
  journeyTag?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type JourneyComponentFieldType =
  | "string"
  | "text"
  | "number"
  | "integer"
  | "boolean"
  | "select"
  | "json"
  | "url"
  | "email"
  | (string & {});

export type JourneyComponentFieldOption = {
  label: string;
  value: string | number | boolean;
  description?: string | null;
};

export type JourneyComponentSchemaField = {
  key: string;
  label: string;
  type: JourneyComponentFieldType;
  required?: boolean;
  placeholder?: string | null;
  helperText?: string | null;
  defaultValue?: string | number | boolean | null;
  options?: JourneyComponentFieldOption[];
  validation?: Record<string, unknown> | null;
};

export type JourneyComponentSchema = {
  version?: number | null;
  fields: JourneyComponentSchemaField[];
  notes?: string | null;
};

export type JourneyComponentScriptConfig = {
  scriptSlug: string;
  scriptVersion?: string | null;
  scriptRuntime?: "celery" | "bullmq" | "edge_worker" | (string & {}) | null;
  scriptEntrypoint?: string | null;
};

export type JourneyComponentScriptConfigApi = {
  script_slug: string;
  script_version?: string | null;
  script_runtime?: string | null;
  script_entrypoint?: string | null;
};

export type JourneyComponentProviderDependency = {
  providerId: string;
  serviceId?: string | null;
  scopes?: string[];
  secrets?: string[];
};

export type JourneyComponentRetryPolicy = {
  maxAttempts: number;
  backoffSeconds?: number | null;
  strategy?: "fixed" | "linear" | "exponential" | (string & {});
};

export type JourneyComponentTelemetryLabels = Record<string, string>;

export type JourneyComponentDefinition = JourneyComponentScriptConfig & {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  triggers: JourneyComponentTrigger[];
  inputSchema: JourneyComponentSchema;
  outputSchema?: JourneyComponentSchema | null;
  providerDependencies?: JourneyComponentProviderDependency[];
  timeoutSeconds?: number | null;
  retryPolicy?: JourneyComponentRetryPolicy | null;
  telemetryLabels?: JourneyComponentTelemetryLabels | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type JourneyComponentDefinitionApi = JourneyComponentScriptConfigApi & {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  triggers: JourneyComponentTrigger[];
  input_schema: JourneyComponentSchema;
  output_schema?: JourneyComponentSchema | null;
  provider_dependencies?: JourneyComponentProviderDependency[];
  timeout_seconds?: number | null;
  retry_policy?: JourneyComponentRetryPolicy | null;
  telemetry_labels?: JourneyComponentTelemetryLabels | null;
  tags?: string[];
  metadata_json?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function normalizeJourneyComponentDefinition(
  payload: JourneyComponentDefinitionApi,
): JourneyComponentDefinition {
  return {
    scriptSlug: payload.script_slug,
    scriptVersion: payload.script_version ?? null,
    scriptRuntime: payload.script_runtime ?? null,
    scriptEntrypoint: payload.script_entrypoint ?? null,
    id: payload.id,
    key: payload.key,
    name: payload.name,
    description: payload.description ?? null,
    triggers: payload.triggers ?? [],
    inputSchema: payload.input_schema,
    outputSchema: payload.output_schema ?? null,
    providerDependencies: payload.provider_dependencies ?? [],
    timeoutSeconds: payload.timeout_seconds ?? null,
    retryPolicy: payload.retry_policy ?? null,
    telemetryLabels: payload.telemetry_labels ?? null,
    tags: payload.tags ?? [],
    metadata: payload.metadata_json ?? null,
    createdAt: payload.created_at ? new Date(payload.created_at) : undefined,
    updatedAt: payload.updated_at ? new Date(payload.updated_at) : undefined,
  };
}

export type JourneyComponentInputBinding =
  | {
      kind: "static";
      inputKey: string;
      value: string | number | boolean | null;
    }
  | {
      kind: "product_field";
      inputKey: string;
      path: string;
      required?: boolean;
    }
  | {
      kind: "runtime";
      inputKey: string;
      source: string;
      required?: boolean;
    };

export type ProductJourneyComponent = {
  id: string;
  productId: string;
  componentId: string;
  displayOrder: number;
  channelEligibility?: string[];
  isRequired?: boolean;
  bindings: JourneyComponentInputBinding[];
  metadata?: Record<string, unknown> | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type ProductJourneyComponentApi = {
  id: string;
  product_id: string;
  component_id: string;
  display_order: number;
  channel_eligibility?: string[] | null;
  is_required?: boolean | null;
  bindings: JourneyComponentInputBinding[];
  metadata_json?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function normalizeProductJourneyComponent(
  payload: ProductJourneyComponentApi,
): ProductJourneyComponent {
  return {
    id: payload.id,
    productId: payload.product_id,
    componentId: payload.component_id,
    displayOrder: payload.display_order,
    channelEligibility: payload.channel_eligibility ?? undefined,
    isRequired: payload.is_required ?? undefined,
    bindings: payload.bindings ?? [],
    metadata: payload.metadata_json ?? null,
    createdAt: payload.created_at ? new Date(payload.created_at) : undefined,
    updatedAt: payload.updated_at ? new Date(payload.updated_at) : undefined,
  };
}

export type JourneyComponentRunStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type JourneyComponentRun = {
  id: string;
  runToken: string;
  productId?: string | null;
  productComponentId?: string | null;
  componentId: string;
  channel?: string | null;
  trigger?: JourneyComponentTrigger | null;
  inputPayload?: Record<string, unknown> | null;
  bindingSnapshot?: JourneyComponentInputBinding[] | Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  telemetry?: Record<string, unknown> | null;
  status: JourneyComponentRunStatus;
  attempts: number;
  errorMessage?: string | null;
  resultPayload?: Record<string, unknown> | null;
  queuedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type JourneyComponentHealthSummary = {
  componentId: string;
  productComponentId?: string | null;
  runCount: number;
  successCount: number;
  failureCount: number;
  lastRun?: JourneyComponentRun | null;
};

export type JourneyComponentRunRequest = {
  componentId: string;
  productId?: string | null;
  productComponentId?: string | null;
  channel?: string | null;
  trigger?: JourneyComponentTrigger | null;
  inputPayload?: Record<string, unknown> | null;
  bindings?: JourneyComponentInputBinding[];
  metadata?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
};

export type ProductJourneyRuntime = {
  productId: string;
  slug: string;
  title: string;
  journeyComponents: ProductJourneyComponent[];
  recentRuns: JourneyComponentRun[];
  componentHealth?: JourneyComponentHealthSummary[];
};
