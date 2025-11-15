"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { AdminFilterPill } from "@/components/admin";

// meta: component: admin-onboarding-filters

const FILTERS = [
  { value: "all", label: "All" },
  { value: "stalled", label: "Stalled" },
  { value: "referrals", label: "Referrals" }
] as const;

type FilterValue = (typeof FILTERS)[number]["value"];

export function OnboardingFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  let active: FilterValue = "all";
  if (searchParams.get("stalled") === "true") {
    active = "stalled";
  } else if (searchParams.get("referrals") === "true") {
    active = "referrals";
  }

  const handleSelect = (value: FilterValue) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("stalled");
    params.delete("referrals");

    if (value === "stalled") {
      params.set("stalled", "true");
    } else if (value === "referrals") {
      params.set("referrals", "true");
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {FILTERS.map((filter) => (
        <AdminFilterPill key={filter.value} active={active === filter.value} onClick={() => handleSelect(filter.value)}>
          {filter.label}
        </AdminFilterPill>
      ))}
    </div>
  );
}
