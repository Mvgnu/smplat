import type {
  MarketingPreviewHistoryClientParams,
  MarketingPreviewHistoryResponse,
} from "./historyClient";

const cache = new Map<string, MarketingPreviewHistoryResponse>();

const toKey = (params: MarketingPreviewHistoryClientParams): string =>
  JSON.stringify({
    ...params,
    signal: undefined,
  });

export const primeHistoryClientCache = (
  params: MarketingPreviewHistoryClientParams,
  payload: MarketingPreviewHistoryResponse,
): void => {
  cache.set(toKey(params), payload);
};

export const consumeHistoryClientCache = (
  params: MarketingPreviewHistoryClientParams,
): MarketingPreviewHistoryResponse | null => {
  const key = toKey(params);
  const payload = cache.get(key) ?? null;
  if (payload) {
    cache.delete(key);
  }
  return payload;
};
