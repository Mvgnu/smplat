'use client';

import { motion, useInView } from 'framer-motion';
import { useRef, useEffect, useState } from 'react';

type Stat = {
  icon?: string;
  value: string;
  label: string;
  description?: string;
};

type StatsCounterProps = {
  heading?: string;
  subheading?: string;
  stats: Stat[];
  layoutStyle?: 'grid' | 'row';
};

// Counter animation hook
function useCountUp(end: number, duration: number = 2000, shouldStart: boolean = false) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!shouldStart) return;

    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = timestamp - startTime;
      const percentage = Math.min(progress / duration, 1);

      // Easing function for smooth animation
      const easeOutQuart = 1 - Math.pow(1 - percentage, 4);
      setCount(Math.floor(end * easeOutQuart));

      if (percentage < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrame);
  }, [end, duration, shouldStart]);

  return count;
}

function StatItem({ stat, index, inView }: { stat: Stat; index: number; inView: boolean }) {
  // Extract numeric value from string if possible for animation
  const numericMatch = stat.value.match(/[\d,]+/);
  const numericValue = numericMatch ? parseInt(numericMatch[0].replace(/,/g, '')) : 0;
  const hasNumeric = numericValue > 0;

  const count = useCountUp(numericValue, 2000, inView && hasNumeric);

  // Reconstruct the display value with animated number
  const displayValue = hasNumeric
    ? stat.value.replace(/[\d,]+/, count.toLocaleString())
    : stat.value;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="text-center"
    >
      {/* Icon */}
      {stat.icon && (
        <div className="mb-4 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center text-3xl">
            {stat.icon}
          </div>
        </div>
      )}

      {/* Animated Value */}
      <div className="text-4xl md:text-5xl font-bold text-gray-900 mb-2">
        {displayValue}
      </div>

      {/* Label */}
      <div className="text-base md:text-lg font-medium text-gray-700 mb-2">
        {stat.label}
      </div>

      {/* Description */}
      {stat.description && (
        <p className="text-sm text-gray-600 leading-relaxed max-w-xs mx-auto">
          {stat.description}
        </p>
      )}
    </motion.div>
  );
}

export function StatsCounter({
  heading,
  subheading,
  stats,
  layoutStyle = 'grid'
}: StatsCounterProps) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-50px' });

  if (!stats || stats.length === 0) {
    return null;
  }

  return (
    <section ref={ref} className="py-16 md:py-24 px-4 bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        {(heading || subheading) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16 max-w-3xl mx-auto"
          >
            {heading && (
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
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

        {/* Stats */}
        <div
          className={
            layoutStyle === 'row'
              ? 'flex flex-wrap justify-center gap-12 md:gap-16'
              : `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-${Math.min(stats.length, 4)} gap-12`
          }
        >
          {stats.map((stat, index) => (
            <StatItem key={index} stat={stat} index={index} inView={inView} />
          ))}
        </div>
      </div>
    </section>
  );
}
