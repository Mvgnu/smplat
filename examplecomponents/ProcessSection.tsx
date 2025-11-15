'use client';
import { motion } from 'framer-motion';

interface ProcessStep {
  step: string;
  title: string;
  description: string;
  icon: string;
}

interface ProcessSectionProps {
  title: ReactNode;
  subtitle: string;
  steps: ProcessStep[];
}

const ProcessSection = ({ title, subtitle, steps }: ProcessSectionProps) => {
  return (
    <section className="py-20 bg-white border-t border-gray-100 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-gray-50 rounded-full opacity-70 -translate-y-1/2 translate-x-1/2"></div>
      <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-50 rounded-full opacity-50 translate-y-1/2 -translate-x-1/3"></div>

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-3xl mx-auto text-center mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl md:text-4xl font-light mb-6 text-gray-900">{title}</h2>
            <p className="text-gray-600 text-lg">{subtitle}</p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative">
          <div className="hidden lg:block absolute top-14 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-blue-100 to-transparent z-0"></div>

          {steps.map((step, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
              className="bg-white border border-gray-100 p-6 rounded-lg shadow-sm hover:shadow-md transition-all duration-300 group relative z-10"
            >
              <div className="relative mb-6">
                <div className="relative z-10 bg-gradient-to-b from-white to-gray-50 w-12 h-12 rounded-full flex items-center justify-center mb-2 group-hover:bg-gradient-to-b group-hover:from-white group-hover:to-blue-50 transition-colors duration-300 border border-gray-100">
                  <span className="text-lg font-light text-gray-800 group-hover:text-blue-600 transition-colors duration-300">{step.step}</span>
                </div>
                <div className="absolute top-0 right-0 transform -translate-y-1/3 translate-x-1/4 w-8 h-8 bg-white rounded-full flex items-center justify-center z-20 border border-gray-100 shadow-sm group-hover:shadow-md transition-all duration-300">
                  <span className="text-sm">{step.icon}</span>
                </div>
              </div>
              <h3 className="text-lg font-medium mb-2 text-gray-800 group-hover:text-blue-600 transition-colors duration-300">{step.title}</h3>
              <p className="text-gray-600 text-sm">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ProcessSection;