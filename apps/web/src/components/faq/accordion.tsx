export type FaqItem = {
  question: string;
  answer: string;
};

type AccordionProps = {
  items: FaqItem[];
};

export function FaqAccordion({ items }: AccordionProps) {
  if (!items.length) {
    return null;
  }

  return (
    <div className="divide-y divide-white/10 rounded-3xl border border-white/10 bg-white/5">
      {items.map((faq, index) => (
        <details key={faq.question ?? index} className="group px-6 py-4">
          <summary className="cursor-pointer text-left text-lg font-medium text-white">
            {faq.question}
          </summary>
          <p className="mt-3 text-sm text-white/70">{faq.answer}</p>
        </details>
      ))}
    </div>
  );
}
