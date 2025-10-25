export type TestimonialCalloutProps = {
  quote: string;
  author?: string;
  role?: string;
  company?: string;
};

export function TestimonialCallout({ quote, author, role, company }: TestimonialCalloutProps) {
  if (!quote) {
    return null;
  }

  return (
    <blockquote className="rounded-3xl border border-white/10 bg-white/5 p-8 text-left backdrop-blur">
      <p className="text-xl italic text-white/80">“{quote}”</p>
      {(author || role || company) && (
        <footer className="mt-6 text-sm text-white/60">
          {author ? <span className="font-semibold text-white">{author}</span> : null}
          {role ? <span> · {role}</span> : null}
          {company ? <span> @ {company}</span> : null}
        </footer>
      )}
    </blockquote>
  );
}
