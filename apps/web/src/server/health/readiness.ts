import "server-only";

const apiBaseUrl =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export type ReceiptStorageComponent = {
  status: string;
  detail: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
};

export async function fetchReceiptStorageComponent(): Promise<ReceiptStorageComponent | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/v1/health/readyz`, {
      next: { revalidate: 120 },
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const component = payload?.components?.receipt_storage;
    if (!component) {
      return null;
    }
    return {
      status: component.status ?? "unknown",
      detail: component.detail ?? null,
      lastSuccessAt: component.last_success_at ?? component.lastSuccessAt ?? null,
      lastErrorAt: component.last_error_at ?? component.lastErrorAt ?? null,
    };
  } catch (error) {
    console.warn("Unable to load receipt storage readiness component", error);
    return null;
  }
}
