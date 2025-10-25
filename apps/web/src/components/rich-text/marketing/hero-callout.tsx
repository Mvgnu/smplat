import Link from "next/link";

type CtaConfig = {
  label?: string;
  href?: string;
};

type HeroCalloutProps = {
  eyebrow?: string;
  headline?: string;
  body?: string;
  primaryCta?: CtaConfig;
  secondaryCta?: CtaConfig;
  align?: "start" | "center";
};

const callToAction = (cta?: CtaConfig, variant: "primary" | "secondary" = "primary") => {
  if (!cta?.href) {
    return null;
  }

  const baseClasses =
    "inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold transition";

  if (variant === "secondary") {
    return (
      <Link
        className={`${baseClasses} border border-white/40 text-white hover:border-white/70`}
        href={cta.href}
      >
        {cta.label ?? "Learn more"}
      </Link>
    );
  }

  return (
    <Link className={`${baseClasses} bg-white text-black hover:bg-white/80`} href={cta.href}>
      {cta.label ?? "Get started"}
    </Link>
  );
};

export function HeroCallout({
  eyebrow,
  headline,
  body,
  primaryCta,
  secondaryCta,
  align = "center"
}: HeroCalloutProps) {
  if (!headline && !body) {
    return null;
  }

  const alignment = align === "start" ? "items-start text-left" : "items-center text-center";

  return (
    <section className={`flex flex-col gap-6 rounded-3xl border border-white/10 bg-white/5 p-10 ${alignment}`}>
      {eyebrow ? (
        <span className="inline-flex items-center rounded-full border border-white/20 px-4 py-1 text-xs uppercase tracking-wide text-white/60">
          {eyebrow}
        </span>
      ) : null}
      {headline ? (
        <h2 className="text-balance text-3xl font-semibold leading-tight text-white md:text-4xl">{headline}</h2>
      ) : null}
      {body ? <p className="max-w-2xl text-base text-white/70">{body}</p> : null}
      {(primaryCta?.href || secondaryCta?.href) && (
        <div className="mt-2 flex flex-wrap gap-4">
          {callToAction(primaryCta, "primary")}
          {callToAction(secondaryCta, "secondary")}
        </div>
      )}
    </section>
  );
}
