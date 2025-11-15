'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

type CtaCardProps = {
  icon?: string;
  heading: string;
  description: string;
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  illustrationUrl?: string;
};

export function CtaCard({
  icon,
  heading,
  description,
  primaryCtaLabel,
  primaryCtaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  illustrationUrl
}: CtaCardProps) {
  return (
    <section className="py-16 md:py-24 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="max-w-4xl mx-auto"
      >
        <div className="relative bg-white rounded-2xl border-2 border-gray-200 p-8 md:p-12 shadow-lg hover:shadow-xl transition-shadow duration-300 overflow-hidden">
          {/* Background Pattern */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-50 to-purple-50 rounded-full blur-3xl opacity-40 -translate-y-1/2 translate-x-1/2" />

          <div className="relative z-10">
            {/* Icon or Illustration */}
            {illustrationUrl ? (
              <div className="mb-8">
                <div className="relative w-full h-48 md:h-64 rounded-xl overflow-hidden">
                  <Image
                    src={illustrationUrl}
                    alt={heading}
                    fill
                    className="object-contain"
                  />
                </div>
              </div>
            ) : icon ? (
              <div className="mb-6">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-200 text-4xl">
                  {icon}
                </div>
              </div>
            ) : null}

            {/* Heading */}
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4 leading-tight">
              {heading}
            </h2>

            {/* Description */}
            <p className="text-lg text-gray-600 mb-8 leading-relaxed">
              {description}
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Link
                href={primaryCtaHref}
                className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-md hover:shadow-lg transition-all duration-300 hover:scale-105"
              >
                {primaryCtaLabel}
                <svg
                  className="ml-2 w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>

              {secondaryCtaHref && (
                <Link
                  href={secondaryCtaHref}
                  className="inline-flex items-center justify-center px-8 py-4 text-base font-semibold text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-all duration-300"
                >
                  {secondaryCtaLabel || 'Learn More'}
                </Link>
              )}
            </div>
          </div>

          {/* Decorative corner accent */}
          <div className="absolute bottom-0 right-0 w-32 h-32 bg-gradient-to-tl from-blue-100 to-transparent rounded-tl-full opacity-50" />
        </div>
      </motion.div>
    </section>
  );
}
