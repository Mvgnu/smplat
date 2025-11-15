'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqSectionProps {
  kicker: string;
  title: ReactNode;
  faqs: FaqItem[];
}

const AccordionItem = ({ faq, index }: { faq: FaqItem; index: number }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.6, delay: index * 0.1 }}
      className="bg-white rounded-lg border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 group"
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-start text-left p-6"
        aria-expanded={isOpen}
      >
        <h3 className="text-xl font-light group-hover:text-blue-600 transition-colors duration-300">
          {faq.question}
        </h3>
        <motion.span
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.3 }}
          className="ml-4 mt-1 text-blue-500 text-2xl"
        >
          +
        </motion.span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <p className="text-gray-600 text-sm leading-relaxed px-6 pb-6">
              {faq.answer}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

const FaqSection = ({ kicker, title, faqs }: FaqSectionProps) => {
  return (
    <section className="py-24 bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center mb-3">
              <div className="w-12 h-[1px] bg-blue-500 mr-4"></div>
              <span className="text-blue-600 uppercase tracking-widest text-xs font-medium">{kicker}</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-light mb-5 tracking-tight">{title}</h2>
          </motion.div>
        </div>
        <div className="max-w-3xl mx-auto space-y-6">
          {faqs.map((faq, index) => (
            <AccordionItem key={index} faq={faq} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default FaqSection;