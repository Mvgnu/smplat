'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

type HeroSplitProps = {
  headline: string;
  subtitle?: string;
  bodyText?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  imageUrl?: string;
  imageAlt?: string;
};

export function HeroSplit({
  headline,
  subtitle,
  bodyText,
  primaryCtaLabel,
  primaryCtaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  imageUrl,
  imageAlt = 'Hero image'
}: HeroSplitProps) {
  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: Text Content */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="order-2 lg:order-1"
          >
            {/* Headline */}
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-gray-900 mb-6 leading-tight">
              {headline}
            </h1>

            {/* Subtitle */}
            {subtitle && (
              <p className="text-xl text-gray-600 mb-6 leading-relaxed">
                {subtitle}
              </p>
            )}

            {/* Body Text */}
            {bodyText && (
              <div className="text-base text-gray-600 mb-8 leading-relaxed space-y-4">
                {bodyText.split('\n').map((paragraph, index) => (
                  paragraph.trim() && <p key={index}>{paragraph}</p>
                ))}
              </div>
            )}

            {/* CTA Buttons */}
            {(primaryCtaHref || secondaryCtaHref) && (
              <div className="flex flex-col sm:flex-row gap-4">
                {primaryCtaHref && (
                  <Link
                    href={primaryCtaHref}
                    className="inline-flex items-center justify-center px-8 py-4 text-base font-medium text-white bg-blue-500 rounded-lg transition-all duration-300 hover:bg-blue-600 hover:shadow-lg hover:scale-105"
                  >
                    {primaryCtaLabel || 'Get Started'}
                  </Link>
                )}

                {secondaryCtaHref && (
                  <Link
                    href={secondaryCtaHref}
                    className="group inline-flex items-center justify-center px-8 py-4 text-base font-medium text-gray-700 hover:text-blue-600 transition-colors duration-300"
                  >
                    {secondaryCtaLabel || 'Learn More'}
                    <svg
                      className="ml-2 w-5 h-5 transition-transform duration-300 group-hover:translate-x-1"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                  </Link>
                )}
              </div>
            )}
          </motion.div>

          {/* Right: Image/Illustration */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="order-1 lg:order-2"
          >
            {imageUrl ? (
              <div className="relative aspect-square md:aspect-[4/3] rounded-2xl overflow-hidden shadow-2xl">
                <Image
                  src={imageUrl}
                  alt={imageAlt}
                  fill
                  className="object-cover"
                  priority
                />
                {/* Decorative elements */}
                <div className="absolute -top-4 -right-4 w-24 h-24 bg-blue-100 rounded-full -z-10" />
                <div className="absolute -bottom-4 -left-4 w-32 h-32 bg-purple-100 rounded-full -z-10" />
              </div>
            ) : (
              // Placeholder if no image provided
              <div className="relative aspect-square md:aspect-[4/3] rounded-2xl bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center shadow-lg">
                <div className="text-center p-8">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-white flex items-center justify-center">
                    <svg
                      className="w-10 h-10 text-blue-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-500">Add an image to enhance your hero</p>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
