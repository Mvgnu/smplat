'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import Image from 'next/image';

type Stat = {
  value: string;
  label: string;
};

type CtaBannerProps = {
  headline: string;
  subtext?: string;
  ctaLabel: string;
  ctaHref: string;
  backgroundStyle?: 'gradient' | 'solid-blue' | 'solid-gray' | 'image';
  backgroundImageUrl?: string;
  stats?: Stat[];
};

const BackgroundLayer = ({
  style,
  imageUrl
}: {
  style: string;
  imageUrl?: string;
}) => {
  if (style === 'image' && imageUrl) {
    return (
      <>
        <Image
          src={imageUrl}
          alt="CTA background"
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-black/50" />
      </>
    );
  }

  if (style === 'gradient') {
    return (
      <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-blue-500 to-purple-600" />
    );
  }

  if (style === 'solid-blue') {
    return <div className="absolute inset-0 bg-blue-600" />;
  }

  if (style === 'solid-gray') {
    return <div className="absolute inset-0 bg-gray-900" />;
  }

  return null;
};

export function CtaBanner({
  headline,
  subtext,
  ctaLabel,
  ctaHref,
  backgroundStyle = 'gradient',
  backgroundImageUrl,
  stats
}: CtaBannerProps) {
  return (
    <section className="relative py-20 md:py-28 px-4 overflow-hidden">
      {/* Background */}
      <BackgroundLayer style={backgroundStyle} imageUrl={backgroundImageUrl} />

      {/* Decorative Elements */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-10 right-10 w-64 h-64 border border-white rounded-full" />
        <div className="absolute bottom-10 left-10 w-96 h-96 border border-white rounded-full" />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight"
        >
          {headline}
        </motion.h2>

        {subtext && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-lg md:text-xl text-white/90 mb-10 leading-relaxed max-w-2xl mx-auto"
          >
            {subtext}
          </motion.p>
        )}

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Link
            href={ctaHref}
            className="inline-flex items-center justify-center px-10 py-5 text-base font-semibold text-blue-600 bg-white rounded-lg shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300"
          >
            {ctaLabel}
            <svg
              className="ml-2 w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </motion.div>

        {/* Stats Row */}
        {stats && stats.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-16 pt-12 border-t border-white/20"
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, index) => (
                <div key={index} className="text-center">
                  <div className="text-3xl md:text-4xl font-bold text-white mb-2">
                    {stat.value}
                  </div>
                  <div className="text-sm text-white/70 uppercase tracking-wider">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
