"use client";

// meta: component: session-provider-boundary
import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

type SessionProviderBoundaryProps = {
  children: ReactNode;
  session: Session;
};

export function SessionProviderBoundary({ children, session }: SessionProviderBoundaryProps) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
