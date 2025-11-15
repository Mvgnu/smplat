'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';

type HeroMinimalProps = {
  statementText: string;
  subtitle?: string;
  enableScrollAnimation?: boolean;
};

export function HeroMinimal({
  statementText,
  subtitle,
  enableScrollAnimation = true
}: HeroMinimalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end start']
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.95]);

  return (
    <motion.section
      ref={ref}
      style={enableScrollAnimation ? { opacity, scale } : {}}
      className="min-h-[70vh] flex items-center justify-center px-4 py-24 relative overflow-hidden"
    >
      {/* Subtle background decoration */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-50 rounded-full blur-3xl opacity-40" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-50 rounded-full blur-3xl opacity-40" />
      </div>

      <div className="max-w-6xl mx-auto text-center">
        {/* Large Statement Text */}
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="text-5xl md:text-7xl lg:text-8xl font-light tracking-tight text-gray-900 mb-8 leading-tight"
        >
          {statementText.split('\n').map((line, index) => (
            <span key={index} className="block">
              {line}
            </span>
          ))}
        </motion.h1>

        {/* Single Line Subtitle */}
        {subtitle && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="flex items-center justify-center gap-4"
          >
            <div className="h-px w-12 bg-gradient-to-r from-transparent to-gray-300" />
            <p className="text-base md:text-lg text-gray-600 font-light tracking-wide">
              {subtitle}
            </p>
            <div className="h-px w-12 bg-gradient-to-l from-transparent to-gray-300" />
          </motion.div>
        )}
      </div>

      {/* Scroll Indicator */}
      {enableScrollAnimation && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 1,
            delay: 1,
            repeat: Infinity,
            repeatType: 'reverse',
            ease: 'easeInOut'
          }}
          className="absolute bottom-8 left-1/2 transform -translate-x-1/2"
        >
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <span className="text-xs uppercase tracking-widest">Scroll</span>
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </div>
        </motion.div>
      )}
    </motion.section>
  );
}
