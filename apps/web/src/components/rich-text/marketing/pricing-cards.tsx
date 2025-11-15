'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useState } from 'react';

type Feature = {
  text: string;
  included: boolean;
};

type Plan = {
  name: string;
  badge?: string;
  description?: string;
  monthlyPrice: number;
  annualPrice?: number;
  currency?: string;
  features: Feature[];
  ctaLabel?: string;
  ctaHref?: string;
  highlighted?: boolean;
};

type PricingCardsProps = {
  kicker?: string;
  heading?: string;
  subheading?: string;
  enableToggle?: boolean;
  plans: Plan[];
};

export function PricingCards({
  kicker,
  heading,
  subheading,
  enableToggle = true,
  plans
}: PricingCardsProps) {
  const [isAnnual, setIsAnnual] = useState(true);

  if (!plans || plans.length === 0) {
    return null;
  }

  return (
    <section className="py-16 md:py-24 px-4 bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          {kicker && (
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-px bg-blue-500 mr-4" />
              <span className="text-blue-600 uppercase tracking-widest text-xs font-medium">
                {kicker}
              </span>
              <div className="w-12 h-px bg-blue-500 ml-4" />
            </div>
          )}
          {heading && (
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {heading}
            </h2>
          )}
          {subheading && (
            <p className="text-lg text-gray-600 leading-relaxed max-w-2xl mx-auto">
              {subheading}
            </p>
          )}
        </motion.div>

        {/* Billing Toggle */}
        {enableToggle && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="flex justify-center mb-12"
          >
            <div className="inline-flex items-center bg-white rounded-full p-1 shadow-sm border border-gray-200">
              <button
                onClick={() => setIsAnnual(false)}
                className={`px-6 py-3 rounded-full text-sm font-medium transition-all duration-300 ${
                  !isAnnual
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setIsAnnual(true)}
                className={`px-6 py-3 rounded-full text-sm font-medium transition-all duration-300 ${
                  isAnnual
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Annual
                <span className="ml-2 text-xs">Save 20%</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* Pricing Cards Grid */}
        <div className={`grid grid-cols-1 md:grid-cols-${Math.min(plans.length, 3)} gap-8 max-w-6xl mx-auto`}>
          {plans.map((plan, index) => {
            const price = isAnnual && plan.annualPrice ? plan.annualPrice : plan.monthlyPrice;
            const currency = plan.currency || '$';

            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className={`relative bg-white rounded-2xl p-8 transition-all duration-300 ${
                  plan.highlighted
                    ? 'ring-2 ring-blue-500 shadow-xl scale-105 md:scale-110'
                    : 'border border-gray-200 shadow-sm hover:shadow-lg'
                }`}
              >
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <span className="inline-block px-4 py-1 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-600 to-blue-400 text-white shadow-md">
                      {plan.badge}
                    </span>
                  </div>
                )}

                {/* Plan Name */}
                <h3 className="text-2xl font-bold text-gray-900 mb-2">
                  {plan.name}
                </h3>

                {/* Description */}
                {plan.description && (
                  <p className="text-sm text-gray-600 mb-6">
                    {plan.description}
                  </p>
                )}

                {/* Price */}
                <div className="mb-8">
                  <div className="flex items-baseline">
                    <span className="text-5xl font-bold text-gray-900">
                      {currency}{price}
                    </span>
                    <span className="ml-2 text-gray-600">
                      /{isAnnual ? 'year' : 'month'}
                    </span>
                  </div>
                  {isAnnual && plan.annualPrice && (
                    <p className="text-sm text-gray-500 mt-2">
                      Billed annually at {currency}{plan.annualPrice}
                    </p>
                  )}
                </div>

                {/* CTA Button */}
                {plan.ctaHref && (
                  <Link
                    href={plan.ctaHref}
                    className={`block w-full text-center px-6 py-4 rounded-lg font-semibold mb-8 transition-all duration-300 ${
                      plan.highlighted
                        ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg'
                        : 'bg-gray-900 text-white hover:bg-gray-800'
                    }`}
                  >
                    {plan.ctaLabel || 'Get Started'}
                  </Link>
                )}

                {/* Features List */}
                <div className="space-y-4 pt-8 border-t border-gray-200">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-4">
                    What&rsquo;s included
                  </p>
                  {plan.features.map((feature, featureIndex) => (
                    <div
                      key={featureIndex}
                      className="flex items-start"
                    >
                      {feature.included ? (
                        <svg
                          className="w-5 h-5 text-blue-600 mr-3 flex-shrink-0 mt-0.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg
                          className="w-5 h-5 text-gray-300 mr-3 flex-shrink-0 mt-0.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                      <span className={`text-sm ${feature.included ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                        {feature.text}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
