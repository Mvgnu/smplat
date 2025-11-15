import type { AdminTab } from "@/components/admin";

// meta: tokens: admin-primary-tabs

export type AdminSection = {
  href: string;
  label: string;
  description: string;
  badge?: string;
  showInTabs?: boolean;
};

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    href: "/admin/orders",
    label: "Orders",
    description: "Track fulfillment milestones"
  },
  {
    href: "/admin/merchandising",
    label: "Merchandising",
    description: "Manage products and bundles"
  },
  {
    href: "/admin/fulfillment/providers",
    label: "Fulfillment",
    description: "Manage provider catalog and overrides"
  },
  {
    href: "/admin/products",
    label: "Products",
    description: "Create storefront-ready SKUs"
  },
  {
    href: "/admin/loyalty",
    label: "Loyalty",
    description: "Tune guardrails and rewards"
  },
  {
    href: "/admin/onboarding",
    label: "Operations",
    description: "Guide manual outreach"
  }
];

export const ADMIN_PRIMARY_TABS: AdminTab[] = ADMIN_SECTIONS.filter((section) => section.showInTabs !== false).map(
  ({ href, label, badge }) => ({
    href,
    label,
    badge
  })
);
