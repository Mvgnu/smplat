export type Testimonial = {
  quote: string;
  author?: string;
  role?: string;
  company?: string;
};

type TestimonialHighlightsProps = {
  items: Testimonial[];
};

export function TestimonialHighlights({ items }: TestimonialHighlightsProps) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {items.map((testimonial, index) => (
        <blockquote
          key={testimonial.quote ?? index}
          className="h-full rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur"
        >
          <p className="text-lg italic text-white/80">“{testimonial.quote}”</p>
          <footer className="mt-6 text-sm text-white/60">
            {testimonial.author ? <span className="font-semibold text-white">{testimonial.author}</span> : null}
            {testimonial.role ? <span> · {testimonial.role}</span> : null}
            {testimonial.company ? <span> @ {testimonial.company}</span> : null}
          </footer>
        </blockquote>
      ))}
    </div>
  );
}
