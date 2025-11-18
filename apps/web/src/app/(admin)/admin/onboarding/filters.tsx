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

type ExperimentFilterGroup = {
  slug: string;
  total: number;
  variants: {
    key: string;
    label: string;
    count: number;
  }[];
};

type OnboardingFiltersProps = {
  experimentFilters: ExperimentFilterGroup[];
};

export function OnboardingFilters({ experimentFilters }: OnboardingFiltersProps) {
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

  const handleExperimentSelect = (slug: string | null, variant: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    const currentSlug = searchParams.get("experimentSlug");
    const currentVariant = searchParams.get("experimentVariant");
    const requestedSlug = slug ?? null;
    const requestedVariant = variant ?? null;
    const isSameSelection =
      requestedSlug === (currentSlug ?? null) && requestedVariant === (currentVariant ?? null);

    params.delete("experimentSlug");
    params.delete("experimentVariant");

    if (!isSameSelection) {
      if (requestedSlug) {
        params.set("experimentSlug", requestedSlug);
      }
      if (requestedVariant) {
        params.set("experimentVariant", requestedVariant);
      }
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const activeExperimentSlug = searchParams.get("experimentSlug");
  const activeExperimentVariant = searchParams.get("experimentVariant");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((filter) => (
          <AdminFilterPill
            key={filter.value}
            active={active === filter.value}
            onClick={() => handleSelect(filter.value)}
          >
            {filter.label}
          </AdminFilterPill>
        ))}
      </div>

      {experimentFilters.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-white/10 bg-black/30 p-3">
          <header className="flex flex-wrap items-center justify-between gap-3 text-[11px] uppercase tracking-[0.3em] text-white/50">
            <span>Pricing experiments</span>
            <AdminFilterPill
              active={!activeExperimentSlug && !activeExperimentVariant}
              onClick={() => handleExperimentSelect(null, null)}
            >
              All experiments
            </AdminFilterPill>
          </header>
          <div className="space-y-3">
            {experimentFilters.map((group) => (
              <article key={group.slug} className="space-y-2 rounded-2xl border border-white/5 bg-white/5 p-3 text-xs text-white/60">
                <div className="flex items-center justify-between text-[13px] font-semibold text-white">
                  <span className="uppercase tracking-[0.25em] text-white/70">{group.slug}</span>
                  <span className="text-white/60">{group.total} journeys</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <AdminFilterPill
                    active={!!activeExperimentSlug && !activeExperimentVariant && activeExperimentSlug === group.slug}
                    onClick={() => handleExperimentSelect(group.slug, null)}
                  >
                    All ({group.total})
                  </AdminFilterPill>
                  {group.variants.map((variant) => (
                    <AdminFilterPill
                      key={`${group.slug}-${variant.key}`}
                      active={
                        activeExperimentSlug === group.slug && activeExperimentVariant === variant.key
                      }
                      onClick={() => handleExperimentSelect(group.slug, variant.key)}
                    >
                      {variant.label} ({variant.count})
                    </AdminFilterPill>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
