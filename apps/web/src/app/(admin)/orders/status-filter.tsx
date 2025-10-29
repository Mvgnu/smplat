"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AdminFilterPill } from "@/components/admin";

// meta: component: admin-order-status-filters

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "processing", label: "Processing" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On hold" },
  { value: "canceled", label: "Canceled" }
] as const;

type StatusValue = (typeof STATUS_FILTERS)[number]["value"];

export function OrderStatusFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = (searchParams.get("status") as StatusValue | null) ?? "all";

  const handleSelect = (value: StatusValue) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      params.delete("status");
    } else {
      params.set("status", value);
    }
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_FILTERS.map((filter) => (
        <AdminFilterPill
          key={filter.value}
          active={active === filter.value}
          onClick={() => handleSelect(filter.value)}
        >
          {filter.label}
        </AdminFilterPill>
      ))}
    </div>
  );
}
