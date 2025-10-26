// meta: marketing-block: timeline

type TimelineItem = {
  title?: string;
  description?: string;
  timestamp?: string;
};

type TimelineShowcaseProps = {
  heading?: string;
  subheading?: string;
  items: TimelineItem[];
};

const isMeaningful = (item: TimelineItem) => !!(item.title || item.description);

export function TimelineShowcase({ heading, subheading, items }: TimelineShowcaseProps) {
  const validItems = items.filter(isMeaningful);

  if (validItems.length === 0) {
    return null;
  }

  return (
    <section className="space-y-8">
      {heading ? <h3 className="text-2xl font-semibold text-white">{heading}</h3> : null}
      {subheading ? <p className="max-w-3xl text-white/70">{subheading}</p> : null}
      <ol className="relative space-y-8 border-l border-white/10 pl-6">
        {validItems.map((item, index) => (
          <li key={item.title ?? item.timestamp ?? index} className="relative space-y-2">
            <span className="absolute -left-[7px] flex h-3 w-3 rounded-full border border-white/30 bg-white/20" />
            {item.timestamp ? (
              <p className="text-xs uppercase tracking-wide text-white/60">{item.timestamp}</p>
            ) : null}
            {item.title ? <p className="text-lg font-medium text-white">{item.title}</p> : null}
            {item.description ? <p className="text-sm text-white/70">{item.description}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export type { TimelineItem };
