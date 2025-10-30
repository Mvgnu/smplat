import "server-only";

import { Attributes, SpanKind, SpanStatusCode, context, trace } from "@opentelemetry/api";

import { appLogger } from "@/server/observability/logger";

const tracer = trace.getTracer("smplat-web");

type MaybePromise<T> = T | Promise<T>;

type SpanAttributes = Attributes | undefined;

type ActionHandler<TArgs extends unknown[], TResult> = (...args: TArgs) => MaybePromise<TResult>;

type WrappedAction<TArgs extends unknown[], TResult> = (...args: TArgs) => Promise<TResult>;

const runWithinContext = async <T>(name: string, handler: () => MaybePromise<T>, attributes: SpanAttributes): Promise<T> => {
  const span = tracer.startSpan(name, { kind: SpanKind.INTERNAL, attributes });
  try {
    return await context.with(trace.setSpan(context.active(), span), handler);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    appLogger.error("server_action_failed", { name, message: err.message });
    throw error;
  } finally {
    span.end();
  }
};

export async function withActionSpan<T>(name: string, handler: () => MaybePromise<T>, attributes?: SpanAttributes): Promise<T> {
  return runWithinContext(name, handler, attributes);
}

export function wrapServerAction<TArgs extends unknown[], TResult>(
  name: string,
  handler: ActionHandler<TArgs, TResult>,
  attributes?: SpanAttributes
): WrappedAction<TArgs, TResult> {
  return async (...args: TArgs) =>
    runWithinContext(name, () => handler(...args), {
      ...attributes,
      "server.action.argsLength": args.length,
    });
}

export const serverTelemetry = {
  wrapServerAction,
  withActionSpan,
};

export type { SpanAttributes };
