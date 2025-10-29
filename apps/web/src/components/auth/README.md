# Auth components

`SessionProviderBoundary` hydrates NextAuth session data for client components that live under
server-driven layouts. Always supply an authenticated session when rendering this boundary to
keep downstream hooks in sync with middleware policies.
