export type CaseStudy = {
  title?: string;
  client?: string;
  industry?: string;
  summary?: string;
  results?: Array<{ label?: string; value?: string }>;
  quote?: string;
  quoteAuthor?: string;
};

type CaseStudyHighlightProps = {
  caseStudy?: CaseStudy | null;
};

export function CaseStudyHighlight({ caseStudy }: CaseStudyHighlightProps) {
  if (!caseStudy) {
    return null;
  }

  const { title, client, industry, summary, results, quote, quoteAuthor } = caseStudy;

  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-10 backdrop-blur">
      {client ? <p className="text-sm uppercase tracking-wide text-white/50">{client}</p> : null}
      {title ? <h3 className="text-2xl font-semibold text-white">{title}</h3> : null}
      {industry ? <p className="text-sm text-white/60">{industry}</p> : null}
      {summary ? <p className="text-white/70">{summary}</p> : null}
      {results && results.length ? (
        <ul className="mt-6 grid gap-3 sm:grid-cols-3">
          {results.map((result, index) => (
            <li key={`${result.label}-${index}`} className="rounded-2xl border border-white/10 p-4">
              <p className="text-2xl font-semibold text-white">{result.value ?? ""}</p>
              <p className="text-sm text-white/60">{result.label ?? ""}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {quote ? (
        <blockquote className="border-l-2 border-white/20 pl-4 text-white/70">
          “{quote}”
          {quoteAuthor ? <footer className="mt-3 text-sm text-white/50">— {quoteAuthor}</footer> : null}
        </blockquote>
      ) : null}
    </div>
  );
}
