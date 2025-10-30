// meta: module: auth-fingerprint
import { createHash } from "crypto";
import type { NextRequest } from "next/server";

type FingerprintResult = {
  hash: string | null;
  ip: string | null;
  userAgent: string | null;
};

function extractClientIp(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [first] = forwardedFor.split(",");
    if (first) {
      return first.trim();
    }
  }

  const realIp = headers.get("x-real-ip") ?? headers.get("cf-connecting-ip");
  if (realIp) {
    return realIp.trim();
  }

  return null;
}

export function computeFingerprintFromRequest(request: Request | NextRequest | null | undefined): FingerprintResult {
  if (!request) {
    return { hash: null, ip: null, userAgent: null };
  }

  const headers = request.headers;
  const userAgent = headers.get("user-agent");
  const ip = extractClientIp(headers);
  const acceptLanguage = headers.get("accept-language") ?? "";

  if (!userAgent && !ip) {
    return { hash: null, ip: ip ?? null, userAgent: userAgent ?? null };
  }

  const raw = [userAgent ?? "", ip ?? "", acceptLanguage].join(":");
  const hash = createHash("sha256").update(raw).digest("hex");

  return { hash, ip: ip ?? null, userAgent: userAgent ?? null };
}
