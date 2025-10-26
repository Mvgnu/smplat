// meta: marketing-block: cta-cluster

import Link from "next/link";

type CtaItem = {
  label?: string;
  href?: string;
  description?: string;
};

type CtaClusterProps = {
  heading?: string;
  subheading?: string;
  align?: "start" | "center";
  ctas: CtaItem[];
};

const clusterAlignment = (align: "start" | "center" | undefined) =>
  align === "start" ? "items-start text-left" : "items-center text-center";

const clusterJustify = (align: "start" | "center" | undefined) =>
  align === "start" ? "justify-start" : "justify-center";

export function CtaCluster({ heading, subheading, align, ctas }: CtaClusterProps) {
  const validCtas = ctas.filter((cta) => cta.label && cta.href);

  if (validCtas.length === 0) {
    return null;
  }

  const alignmentClass = clusterAlignment(align);
  const justifyClass = clusterJustify(align);

  return (
    <section className={`flex flex-col gap-6 ${alignmentClass}`}>
      {heading ? <h3 className="text-2xl font-semibold text-white">{heading}</h3> : null}
      {subheading ? <p className="max-w-2xl text-white/70">{subheading}</p> : null}
      <div className={`flex flex-wrap gap-4 ${justifyClass}`}>
        {validCtas.map((cta, index) => (
          <div
            key={cta.href ?? index}
            className="flex flex-col items-center gap-2 rounded-full border border-white/10 bg-white/5 px-6 py-4 text-center backdrop-blur"
          >
            <Link className="text-sm font-semibold text-white hover:text-white/80" href={cta.href!}>
              {cta.label}
            </Link>
            {cta.description ? <p className="text-xs text-white/60">{cta.description}</p> : null}
          </div>
        ))}
      </div>
    </section>
  );
}

export type { CtaItem };
