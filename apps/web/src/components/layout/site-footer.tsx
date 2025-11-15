"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const HIDE_FOOTER_PREFIXES = ["/admin", "/dashboard"];

const FOOTER_LINK_GROUPS = [
  {
    title: "Platform",
    links: [
      { href: "/products", label: "Products" },
      { href: "/pricing", label: "Pricing" },
      { href: "/campaigns", label: "Campaigns" }
    ]
  },
  {
    title: "Resources",
    links: [
      { href: "/blog", label: "Blog" },
      { href: "/campaigns", label: "Case studies" },
      { href: "/login", label: "Customer portal" }
    ]
  },
  {
    title: "Company",
    links: [
      { href: "#contact", label: "Contact" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" }
    ]
  }
];

export function SiteFooter() {
  const pathname = usePathname();
  const shouldHide = pathname ? HIDE_FOOTER_PREFIXES.some((prefix) => pathname.startsWith(prefix)) : false;

  if (shouldHide) {
    return null;
  }

  return (
    <footer className="border-t border-white/10 bg-black/80 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-12 md:flex-row md:justify-between">
        <div className="max-w-sm space-y-3">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/10 text-base uppercase">sm</span>
            SMPLAT
          </div>
          <p className="text-sm text-white/60">
            Social media promotion infrastructure that lets agencies productise services, automate fulfillment, and
            deliver transparent performance reporting.
          </p>
          <p className="text-xs uppercase tracking-[0.3em] text-white/40">© {new Date().getFullYear()} SMPLAT</p>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-8 text-sm text-white/70 sm:grid-cols-2 md:grid-cols-3">
          {FOOTER_LINK_GROUPS.map((group) => (
            <div key={group.title} className="space-y-3">
              <h3 className="text-xs uppercase tracking-[0.3em] text-white/40">{group.title}</h3>
              <ul className="space-y-2">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link className="transition hover:text-white" href={link.href}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
