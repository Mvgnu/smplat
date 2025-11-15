'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';

type HeroCenteredProps = {
  headline: string;
  subtitle?: string;
  primaryCtaLabel?: string;
  primaryCtaHref?: string;
  secondaryCtaLabel?: string;
  secondaryCtaHref?: string;
  backgroundPattern?: 'none' | 'gradient' | 'dots' | 'grid';
};

const BackgroundPattern = ({ pattern }: { pattern: string }) => {
  if (pattern === 'gradient') {
    return (
      <div className="absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob" />
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-purple-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-2000" />
        <div className="absolute -bottom-32 left-1/2 w-96 h-96 bg-pink-100 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-blob animation-delay-4000" />
      </div>
    );
  }

  if (pattern === 'dots') {
    return (
      <div className="absolute inset-0 -z-10 overflow-hidden opacity-30">
        <div className="absolute inset-0" style={{
          backgroundImage: 'radial-gradient(circle, #3b82f6 1px, transparent 1px)',
          backgroundSize: '32px 32px'
        }} />
      </div>
    );
  }

  if (pattern === 'grid') {
    return (
      <div className="absolute inset-0 -z-10 overflow-hidden opacity-20">
        <div className="absolute inset-0" style={{
          backgroundImage: 'linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)',
          backgroundSize: '64px 64px'
        }} />
      </div>
    );
  }

  return null;
};

export function HeroCentered({
  headline,
  subtitle,
  primaryCtaLabel,
  primaryCtaHref,
  secondaryCtaLabel,
  secondaryCtaHref,
  backgroundPattern = 'none'
}: HeroCenteredProps) {
  return (
    <section className="relative py-24 md:py-32 px-4 overflow-hidden">
      <BackgroundPattern pattern={backgroundPattern} />

      <div className="max-w-5xl mx-auto text-center">
        {/* Headline with gradient text effect */}
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-tight"
        >
          {headline.split('\n').map((line, index, array) => (
            <span key={index}>
              {index === array.length - 1 ? (
                <span className="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">
                  {line}
                </span>
              ) : (
                <span className="text-gray-900">{line}</span>
              )}
              {index < array.length - 1 && <br />}
            </span>
          ))}
        </motion.h1>

        {/* Subtitle */}
        {subtitle && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-lg md:text-xl text-gray-600 mb-10 max-w-3xl mx-auto leading-relaxed"
          >
            {subtitle}
          </motion.p>
        )}

        {/* CTA Buttons */}
        {(primaryCtaHref || secondaryCtaHref) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex flex-col sm:flex-row gap-4 justify-center items-center"
          >
            {primaryCtaHref && (
              <Link
                href={primaryCtaHref}
                className="group relative inline-flex items-center justify-center px-8 py-4 text-base font-medium text-white bg-blue-500 rounded-lg overflow-hidden transition-all duration-300 hover:bg-blue-600 hover:shadow-lg hover:scale-105"
              >
                <span className="relative z-10">{primaryCtaLabel || 'Get Started'}</span>
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-blue-500 transform scale-x-0 origin-left transition-transform duration-300 group-hover:scale-x-100" />
              </Link>
            )}

            {secondaryCtaHref && (
              <Link
                href={secondaryCtaHref}
                className="inline-flex items-center justify-center px-8 py-4 text-base font-medium text-gray-700 bg-white border-2 border-gray-200 rounded-lg transition-all duration-300 hover:border-blue-500 hover:text-blue-600 hover:shadow-md"
              >
                {secondaryCtaLabel || 'Learn More'}
                <svg
                  className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            )}
          </motion.div>
        )}
      </div>
    </section>
  );
}
