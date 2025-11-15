import type { ReactNode } from "react";

import { AdminShell, type AdminNavItem } from "@/components/admin";
import { SessionProviderBoundary } from "@/components/auth/session-provider";
import { requireRole } from "@/server/auth/policies";
import { ADMIN_SECTIONS } from "./admin-tabs";

// meta: layout: admin-root

type AdminRootLayoutProps = {
  children: ReactNode;
};

export default async function AdminRootLayout({ children }: AdminRootLayoutProps) {
  const { session } = await requireRole("operator", {
    redirectTo: "/login?next=/admin",
    context: {
      route: "admin.layout",
      method: "GET"
    }
  });

  const operatorName = session?.user?.name ?? "Operator";
  const roleLabel = session?.user?.role ? session.user.role.toString().replaceAll("_", " ") : "operator";

  const baseNavItems: AdminNavItem[] = ADMIN_SECTIONS.map(({ href, label, description }) => ({
    href,
    label,
    description
  }));

  const navItems: AdminNavItem[] =
    session?.user?.role === "ADMIN"
      ? [
          ...baseNavItems,
          {
            href: "/admin/security",
            label: "Security",
            description: "Review access attempts"
          }
        ]
      : baseNavItems;

  return (
    <SessionProviderBoundary session={session}>
      <AdminShell
        navItems={navItems}
        title={`${operatorName} workspace`}
        subtitle="Monitor orders, loyalty health, and merchandising workflows in one unified control center."
        sidebarFooter={
          <div className="space-y-1">
            <p className="text-sm font-medium text-white">{operatorName}</p>
            <p className="text-xs uppercase tracking-[0.3em] text-white/40">{roleLabel}</p>
            <p className="text-xs text-white/50">Role-based access enforced</p>
          </div>
        }
        topRightSlot={
          <button className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:border-white/30 hover:text-white">
            Notifications
          </button>
        }
      >
        {children}
      </AdminShell>
    </SessionProviderBoundary>
  );
}
