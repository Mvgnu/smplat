// meta: module: csrf-security
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";

export const CSRF_COOKIE_NAME = "smplat.csrf";
const CSRF_HEADER_NAME = "x-smplat-csrf";

const SIX_HOURS_IN_SECONDS = 6 * 60 * 60;

export const csrfCookieConfig = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SIX_HOURS_IN_SECONDS
};

export function getOrCreateCsrfToken(): string {
  const cookieStore = cookies();
  const existing = cookieStore.get(CSRF_COOKIE_NAME)?.value;

  if (existing) {
    return existing;
  }

  return crypto.randomBytes(32).toString("hex");
}

type EnsureOptions = {
  tokenFromForm?: string | null;
};

export function ensureCsrfToken(options: EnsureOptions = {}): void {
  const cookieStore = cookies();
  const headerStore = headers();

  const cookieToken = cookieStore.get(CSRF_COOKIE_NAME)?.value ?? null;
  const headerToken = headerStore.get(CSRF_HEADER_NAME);
  const providedToken = typeof options.tokenFromForm === "string" ? options.tokenFromForm : null;

  const matches = [providedToken, headerToken].filter(Boolean).some((token) => token === cookieToken);

  if (matches) {
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("CSRF token missing or invalid – bypass permitted in non-production environment.");
    return;
  }

  throw new Error("Invalid or missing CSRF token.");
}
