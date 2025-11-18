"use client";

import { useMemo, type ChangeEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { usePlatformSelection, useStorefrontStateActions } from "@/context/storefront-state";
import { usePlatformRouteUpdater } from "@/hooks/usePlatformRouting";
import { storefrontExperience } from "@/data/storefront-experience";

const HIDE_NAV_PREFIXES = ["/admin", "/dashboard"];

const PRIMARY_LINKS = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/blog", label: "Blog" }
];

const SECONDARY_LINKS = [
  { href: "/login", label: "Log in" },
  { href: "/dashboard", label: "Dashboard" }
];

const PLATFORM_OPTIONS = storefrontExperience.platforms.map((platform) => ({
  id: platform.id,
  label: platform.name,
  tagline: platform.tagline,
  description: platform.description
}));

export function MainNav() {
  const pathname = usePathname();
  const shouldHide = pathname ? HIDE_NAV_PREFIXES.some((prefix) => pathname.startsWith(prefix)) : false;

  if (shouldHide) {
    return null;
  }

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/70 text-white backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4 text-sm">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-wide text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/10 text-base uppercase">sm</span>
          <span>SMPLAT</span>
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {PRIMARY_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`transition ${
                  isActive ? "text-white" : "text-white/70 hover:text-white"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <PlatformScopeControl />
          {SECONDARY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-semibold text-white/80 transition hover:border-white/40 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
          <a
            href="#contact"
            className="hidden rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-white/80 md:inline-flex"
          >
            Book demo
          </a>
        </div>
      </div>
    </header>
  );
}

function PlatformScopeControl() {
  const selected = usePlatformSelection();
  const { setPlatform } = useStorefrontStateActions();
  const updateRoute = usePlatformRouteUpdater();

  const activeValue = selected?.id ?? "";
  const options = useMemo(
    () => [
      { id: "", label: "All platforms", description: "Full catalog" },
      ...PLATFORM_OPTIONS.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.tagline ?? option.description ?? "Platform-aware defaults"
      }))
    ],
    []
  );
  const activeOption = options.find((option) => option.id === activeValue);

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (!value) {
      setPlatform(null);
      updateRoute(null);
      return;
    }
    const next = PLATFORM_OPTIONS.find((option) => option.id === value);
    if (!next) {
      return;
    }
    setPlatform({
      id: next.id,
      label: next.label,
      platformType: next.tagline
    });
    updateRoute(next.id);
  };

  return (
    <label className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
      <span className="hidden font-semibold uppercase tracking-[0.2em] text-white/40 sm:inline">
        Platform
      </span>
      <select
        className="bg-transparent text-xs font-semibold text-white outline-none"
        onChange={handleChange}
        value={activeValue}
        aria-label="Select storefront platform context"
        title={activeOption?.description ?? undefined}
      >
        {options.map((option) => (
          <option key={option.id || "all-platforms"} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
