'use client';

import { motion } from 'framer-motion';

type Feature = {
  icon?: string;
  title: string;
  description: string;
  badge?: string;
};

type FeatureGridEnhancedProps = {
  kicker?: string;
  heading?: string;
  subheading?: string;
  columns?: '2' | '3' | '4';
  features: Feature[];
  showNumberBadges?: boolean;
};

const columnClasses = {
  '2': 'md:grid-cols-2',
  '3': 'md:grid-cols-2 lg:grid-cols-3',
  '4': 'md:grid-cols-2 lg:grid-cols-4'
};

export function FeatureGridEnhanced({
  kicker,
  heading,
  subheading,
  columns = '3',
  features,
  showNumberBadges = false
}: FeatureGridEnhancedProps) {
  if (!features || features.length === 0) {
    return null;
  }

  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        {(kicker || heading || subheading) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="max-w-3xl mb-16"
          >
            {kicker && (
              <div className="flex items-center mb-4">
                <div className="w-12 h-px bg-blue-500 mr-4" />
                <span className="text-blue-600 uppercase tracking-widest text-xs font-medium">
                  {kicker}
                </span>
              </div>
            )}
            {heading && (
              <h2 className="text-3xl md:text-4xl font-light mb-6 tracking-tight text-gray-900">
                {heading}
              </h2>
            )}
            {subheading && (
              <p className="text-lg text-gray-600 leading-relaxed">
                {subheading}
              </p>
            )}
          </motion.div>
        )}

        {/* Feature Grid */}
        <div className={`grid grid-cols-1 ${columnClasses[columns]} gap-8`}>
          {features.map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className="group relative bg-white p-6 md:p-8 rounded-lg border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 hover:border-blue-200"
            >
              {/* Badge */}
              {feature.badge && (
                <span className="absolute top-4 right-4 inline-block px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  {feature.badge}
                </span>
              )}

              {/* Icon or Number Badge */}
              <div className="mb-4">
                {showNumberBadges ? (
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                    <span className="text-xl font-semibold text-blue-600">
                      {(index + 1).toString().padStart(2, '0')}
                    </span>
                  </div>
                ) : feature.icon ? (
                  <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center text-3xl transition-transform duration-300 group-hover:scale-110">
                    {feature.icon}
                  </div>
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center transition-transform duration-300 group-hover:scale-110">
                    <svg
                      className="w-7 h-7 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                )}
              </div>

              {/* Title */}
              <h3 className="text-xl font-medium mb-3 text-gray-900 group-hover:text-blue-600 transition-colors duration-300">
                {feature.title}
              </h3>

              {/* Description */}
              <p className="text-sm text-gray-600 leading-relaxed">
                {feature.description}
              </p>

              {/* Hover Effect Line */}
              <div className="absolute bottom-0 left-0 w-0 h-1 bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300 group-hover:w-full" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
