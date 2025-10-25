import { notFound } from "next/navigation";

import { getPageBySlug } from "@/server/cms/loaders";

type MarketingPageProps = {
  params: { slug: string };
};

export default async function MarketingPage({ params }: MarketingPageProps) {
  const { slug } = params;
  const page = await getPageBySlug(slug);

  if (!page) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-24 text-white">
      <article className="space-y-12">
        <header className="text-center">
          <h1 className="text-4xl font-semibold md:text-5xl">{page.title}</h1>
          {page.hero?.subheadline ? (
            <p className="mt-4 text-lg text-white/70">{page.hero.subheadline}</p>
          ) : null}
        </header>

        {page.content?.map((section) => {
          if (section._type === "testimonial") {
            return (
              <blockquote
                key={section._key ?? section.quote}
                className="rounded-3xl border border-white/10 bg-white/5 p-10 text-left shadow-lg backdrop-blur"
              >
                <p className="text-xl italic text-white/80">“{section.quote}”</p>
                <footer className="mt-6 text-sm text-white/60">
                  {section.author ? <span className="font-semibold text-white">{section.author}</span> : null}
                  {section.role ? <span> · {section.role}</span> : null}
                  {section.company ? <span> @ {section.company}</span> : null}
                </footer>
              </blockquote>
            );
          }

          return (
            <section key={section._key ?? section.heading} className="space-y-3 text-left">
              {section.heading ? <h2 className="text-3xl font-semibold">{section.heading}</h2> : null}
              {section.subheading ? <p className="text-white/70">{section.subheading}</p> : null}
            </section>
          );
        })}
      </article>
    </main>
  );
}
