import { diag, DiagConsoleLogger, DiagLogLevel, trace } from "@opentelemetry/api";
import { Resource } from "@opentelemetry/resources";
import { SemanticResourceAttributes } from "@opentelemetry/semantic-conventions";
import { BatchSpanProcessor, ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const GLOBAL_FLAG = "__SMPLAT_OTEL_INITIALIZED__" as const;

declare global {
  // eslint-disable-next-line no-var -- augment globalThis for instrumentation guard
  var __SMPLAT_OTEL_INITIALIZED__: boolean | undefined;
}

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

const parseHeaders = (raw: string | undefined): Record<string, string> | undefined => {
  if (!raw) {
    return undefined;
  }
  return raw
    .split(",")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, pair) => {
      const [key, value] = pair.split("=", 2);
      if (!key || value === undefined) {
        return acc;
      }
      acc[key.trim()] = value.trim();
      return acc;
    }, {});
};

export function register() {
  if (typeof globalThis[GLOBAL_FLAG] !== "undefined") {
    return;
  }

  if (process.env.NEXT_RUNTIME !== "nodejs") {
    globalThis[GLOBAL_FLAG] = true;
    return;
  }

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: "smplat-web",
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? "development",
  });

  const provider = new NodeTracerProvider({ resource });

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_ENDPOINT;
  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS ?? process.env.NEXT_PUBLIC_OTEL_EXPORTER_OTLP_HEADERS);

  if (endpoint) {
    provider.addSpanProcessor(
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: endpoint.endsWith("/v1/traces") ? endpoint : `${endpoint.replace(/\/$/, "")}/v1/traces`, headers })
      )
    );
  } else {
    provider.addSpanProcessor(new BatchSpanProcessor(new ConsoleSpanExporter()));
  }

  provider.register({
    contextManager: undefined,
    propagator: undefined,
  });

  trace.setGlobalTracerProvider(provider);
  globalThis[GLOBAL_FLAG] = true;
}
