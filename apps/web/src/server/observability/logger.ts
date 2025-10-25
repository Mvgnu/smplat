import "server-only";

type LogLevel = "info" | "warn" | "error";

type LogMeta = Record<string, unknown> | undefined;

const write = (level: LogLevel, message: string, meta: LogMeta) => {
  const payload = {
    // meta: logger=structured
    namespace: "cms",
    level,
    message,
    timestamp: new Date().toISOString(),
    ...meta
  };

  const serialized = JSON.stringify(payload);
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

export const cmsLogger = {
  info: (message: string, meta?: Record<string, unknown>) => write("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("error", message, meta)
};
