// meta: module: auth-middleware
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { NextRequestWithAuth } from "next-auth/middleware";

import { auth } from "./src/server/auth";
import { hasRole, type RoleTier } from "./src/server/auth/policies";
import { consumeRateLimit } from "./src/server/security/rate-limit";

const LOGIN_PATH = "/login";

type RateLimitPolicy = {
  name: string;
  matcher: (path: string) => boolean;
  windowMs: number;
  max: number;
};

const rateLimitPolicies: RateLimitPolicy[] = [
  { name: "auth", matcher: (path) => path.startsWith("/api/auth"), windowMs: 60_000, max: 10 },
  { name: "checkout", matcher: (path) => path.startsWith("/api/checkout"), windowMs: 60_000, max: 20 },
  { name: "loyalty", matcher: (path) => path.startsWith("/api/loyalty"), windowMs: 60_000, max: 30 },
  { name: "onboarding", matcher: (path) => path.startsWith("/api/onboarding"), windowMs: 60_000, max: 30 }
];

const apiPolicies: Array<{ matcher: (path: string) => boolean; tier: RoleTier }> = [
  { matcher: (path) => path.startsWith("/api/billing"), tier: "operator" },
  { matcher: (path) => path.startsWith("/api/analytics"), tier: "operator" },
  { matcher: (path) => path.startsWith("/api/onboarding"), tier: "operator" },
  { matcher: (path) => path.startsWith("/api/loyalty"), tier: "member" },
  { matcher: (path) => path.startsWith("/api/checkout"), tier: "member" }
];

const pagePolicies: Array<{ matcher: (path: string) => boolean; tier: RoleTier }> = [
  { matcher: (path) => path.startsWith("/admin/admin"), tier: "admin" },
  { matcher: (path) => path.startsWith("/admin"), tier: "operator" },
  { matcher: (path) => path.startsWith("/dashboard"), tier: "member" },
  { matcher: (path) => path.startsWith("/account"), tier: "member" }
];

function redirectToLogin(request: NextRequest | NextRequestWithAuth) {
  const loginUrl = new URL(LOGIN_PATH, request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

const middleware = auth((request: NextRequestWithAuth) => {
  const { pathname } = request.nextUrl;

  const ratePolicy = rateLimitPolicies.find((policy) => policy.matcher(pathname));
  if (ratePolicy) {
    // security-rate-limit: ip-identifier
    const clientIdentifier = request.ip ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const rateKey = `${ratePolicy.name}:${clientIdentifier}`;
    const { success } = consumeRateLimit(rateKey, {
      windowMs: ratePolicy.windowMs,
      max: ratePolicy.max
    });

    if (!success) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }
  }

  if (pathname.startsWith("/api/auth") || pathname.startsWith("/api/preview")) {
    return NextResponse.next();
  }

  const isApiRoute = pathname.startsWith("/api/");
  const policies = isApiRoute ? apiPolicies : pagePolicies;

  const match = policies.find((policy) => policy.matcher(pathname));
  if (!match) {
    return NextResponse.next();
  }

  const session = request.auth;

  if (!session?.user) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    return redirectToLogin(request);
  }

  const hasAccess = hasRole(session, match.tier);

  if (hasAccess) {
    return NextResponse.next();
  }

  if (isApiRoute) {
    return NextResponse.json({ error: "Insufficient permissions." }, { status: 403 });
  }

  return redirectToLogin(request);
});

export default middleware;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|assets|robots.txt).*)"],
};
