import "server-only";

type LogLevel = "info" | "warn" | "error";

type LogMeta = Record<string, unknown> | undefined;

const serialize = (payload: Record<string, unknown>) => JSON.stringify(payload);

const write = (level: LogLevel, message: string, namespace: string, meta: LogMeta) => {
  const payload = {
    // meta: logger=structured
    namespace,
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta
  } satisfies Record<string, unknown>;

  const serialized = serialize(payload);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
};

const buildLogger = (namespace: string) => ({
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, namespace, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, namespace, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, namespace, meta)
});

export const cmsLogger = buildLogger("cms");
export const appLogger = buildLogger("app");
export const buildStructuredLogger = buildLogger;
