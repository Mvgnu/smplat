import { ReactNode } from "react";
import { SessionProviderBoundary } from "@/components/auth/session-provider";
import { requireRole } from "@/server/auth/policies";

type ClientLayoutProps = {
  children: ReactNode;
};

export default async function ClientLayout({ children }: ClientLayoutProps) {
  const { session } = await requireRole("member", { redirectTo: "/login" });

  const displayName = session.user?.name ?? session.user?.email ?? "Client";

  return (
    <SessionProviderBoundary session={session}>
      <div className="min-h-screen bg-gradient-to-b from-[#05070F] via-[#080B17] to-[#0A0D1C] text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12">
          <header className="flex flex-col gap-2">
            <p className="uppercase tracking-[0.3em] text-xs text-white/40">Client Workspace</p>
            <h1 className="text-3xl font-semibold">Welcome back, {displayName}</h1>
            <p className="text-white/60">
              Track campaign fulfillment milestones, review catalog performance insights, and stay ahead
              of upcoming deliverables.
            </p>
          </header>
          {children}
        </div>
      </div>
    </SessionProviderBoundary>
  );
}
