import type { StorefrontTestimonial } from "@/data/storefront-experience";

type TestimonialTickerProps = {
  testimonials: StorefrontTestimonial[];
};

export function TestimonialTicker({ testimonials }: TestimonialTickerProps) {
  if (!testimonials.length) {
    return null;
  }

  return (
    <section
      aria-labelledby="testimonial-ticker-heading"
      className="mx-auto w-full max-w-6xl rounded-[32px] border border-white/10 bg-white/5 px-8 py-10 text-white"
    >
      <div className="mb-6 flex flex-col gap-2 text-left">
        <p className="text-sm font-semibold uppercase tracking-[0.25em] text-white/60">Proof across the lifecycle</p>
        <h2 id="testimonial-ticker-heading" className="text-3xl font-semibold">
          Teams trust our storefront telemetry
        </h2>
        <p className="text-white/70">Every quote pairs a measurable outcome with the storefront context that delivered it.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {testimonials.map((testimonial) => (
          <figure
            key={testimonial.id}
            className="flex h-full flex-col justify-between rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-black/5 px-6 py-6"
          >
            <blockquote className="text-left text-lg text-white/80">“{testimonial.quote}”</blockquote>
            <figcaption className="mt-6">
              <p className="text-sm font-semibold text-white">{testimonial.author}</p>
              <p className="text-xs uppercase tracking-wider text-white/60">{testimonial.role}</p>
              <p className="mt-2 text-sm font-semibold text-emerald-300">{testimonial.metric}</p>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

