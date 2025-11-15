'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { ReactNode, useRef } from 'react';

// Type definitions
interface TimelineItem {
  id: string;
  date: string;
  title: string;
  description: string | ReactNode;
  icon?: string | ReactNode;
  badge?: string;
  image?: string;
  highlight?: boolean;
  link?: {
    label: string;
    href: string;
  };
}

interface TimelineProps {
  items: TimelineItem[];
  layout?: 'vertical' | 'alternating' | 'horizontal';
  showProgress?: boolean;
  accentColor?: string;
  className?: string;
  animated?: boolean;
}

interface TimelineCardProps {
  item: TimelineItem;
  index: number;
  position: 'left' | 'right' | 'center';
  accentColor: string;
  animated: boolean;
}

// Timeline Card Component
function TimelineCard({ item, index, position, accentColor, animated }: TimelineCardProps) {
  const isLeft = position === 'left';
  const isCenter = position === 'center';
  
  const cardAnimation = animated ? {
    initial: { opacity: 0, x: isLeft ? -20 : isCenter ? 0 : 20 },
    whileInView: { opacity: 1, x: 0 },
    viewport: { once: true, margin: '-50px' },
    transition: { duration: 0.5, delay: index * 0.1 }
  } : {};
  
  return (
    <motion.div
      {...cardAnimation}
      className={`
        relative mb-16
        ${isCenter ? 'text-left' : isLeft ? 'md:text-right' : 'md:text-left'}
      `}
    >
      {/* Content wrapper */}
      <div className={`
        flex items-center
        ${isCenter ? 'justify-start' : isLeft ? 'md:justify-end' : 'md:justify-start'}
        ${isCenter ? 'w-full' : 'md:w-1/2'}
        ${isCenter ? 'pl-16' : isLeft ? 'md:pr-8' : 'md:pl-8 md:ml-auto'}
        max-md:justify-start max-md:w-full max-md:pl-16
      `}>
        <div className={`
          max-w-md bg-white p-6 rounded-lg
          ${item.highlight ? 'ring-2 ring-blue-400 shadow-lg' : 'border border-gray-100 shadow-sm'}
          hover:shadow-md transition-all duration-300
          ${isCenter ? '' : isLeft ? 'md:border-r-2' : 'md:border-l-2'}
          ${isCenter ? '' : `md:border-${accentColor}-400`}
          max-md:border-l-2 max-md:border-${accentColor}-400
        `}>
          {/* Date and Icon Header */}
          <div className="flex items-center mb-3 justify-between">
            <span className={`
              text-xs font-medium tracking-wider text-${accentColor}-600
              ${isLeft ? 'md:order-2' : 'md:order-1'} max-md:order-1
            `}>
              {item.date}
            </span>
            {item.icon && (
              <span className="text-xl opacity-80" role="img" aria-label="timeline icon">
                {typeof item.icon === 'string' ? item.icon : item.icon}
              </span>
            )}
          </div>
          
          {/* Badge */}
          {item.badge && (
            <span className={`
              inline-block px-2 py-1 mb-2 rounded-full
              text-xs font-medium bg-${accentColor}-100 text-${accentColor}-700
            `}>
              {item.badge}
            </span>
          )}
          
          {/* Title */}
          <h3 className="text-lg font-medium mb-2">{item.title}</h3>
          
          {/* Description */}
          <div className="text-gray-600 text-sm leading-relaxed mb-4">
            {item.description}
          </div>
          
          {/* Link */}
          {item.link && (
            <motion.a
              href={item.link.href}
              className={`
                inline-flex items-center text-sm font-medium
                text-${accentColor}-600 hover:text-${accentColor}-800
                transition-colors duration-200
              `}
              whileHover={{ x: 5 }}
              transition={{ type: 'spring', stiffness: 300 }}
            >
              {item.link.label}
              <span className="ml-2">→</span>
            </motion.a>
          )}
        </div>
      </div>
      
      {/* Timeline Dot */}
      <div className={`
        absolute top-6
        ${isCenter ? 'left-6' : 'md:left-1/2 md:transform md:-translate-x-1/2'}
        max-md:left-6
      `}>
        <motion.div
          className={`
            w-3 h-3 rounded-full border-2 border-white shadow-md z-10 relative
            ${item.highlight ? `bg-${accentColor}-600` : `bg-${accentColor}-400`}
          `}
          whileHover={{ scale: 1.5 }}
          transition={{ type: 'spring', stiffness: 300 }}
        />
      </div>
      
      {/* Connector Line (desktop) */}
      {!isCenter && (
        <div className={`
          absolute top-7 md:block max-md:hidden
          ${isLeft ? 'md:right-[calc(50%+1px)]' : 'md:left-[calc(50%+1px)]'}
          w-8 h-[1px] bg-${accentColor}-300
        `} />
      )}
    </motion.div>
  );
}

// Main Timeline Component
export default function Timeline({
  items,
  layout = 'alternating',
  showProgress = true,
  accentColor = 'blue',
  className = '',
  animated = true
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start 80%', 'end 20%']
  });
  
  // Transform scroll progress for the timeline line
  const lineHeight = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);
  
  // Determine position for each item based on layout
  const getPosition = (index: number): 'left' | 'right' | 'center' => {
    if (layout === 'vertical') return 'center';
    if (layout === 'alternating') return index % 2 === 0 ? 'left' : 'right';
    return 'center';
  };
  
  return (
    <div 
      ref={containerRef}
      className={`relative ${className}`}
      aria-label="Timeline"
    >
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
        className="max-w-3xl mx-auto text-center mb-16"
      >
        <h2 className="text-3xl md:text-4xl font-light mb-4">
          Our <span className={`text-${accentColor}-600`}>Journey</span>
        </h2>
        <p className="text-gray-600 leading-relaxed">
          A timeline of growth, innovation, and achievement
        </p>
      </motion.div>
      
      {/* Timeline Container */}
      <div className="relative max-w-6xl mx-auto">
        {/* Vertical Line */}
        <div className={`
          absolute h-full w-[1px] bg-gray-200
          ${layout === 'vertical' ? 'left-6' : 'md:left-1/2 md:transform md:-translate-x-1/2'}
          max-md:left-6
        `}>
          {/* Animated Progress Line */}
          {showProgress && animated && (
            <motion.div
              className={`absolute top-0 left-0 w-full bg-${accentColor}-400`}
              style={{ height: lineHeight }}
            />
          )}
        </div>
        
        {/* Timeline Items */}
        {items.map((item, index) => (
          <TimelineCard
            key={item.id}
            item={item}
            index={index}
            position={getPosition(index)}
            accentColor={accentColor}
            animated={animated}
          />
        ))}
        
        {/* End Marker */}
        <motion.div
          className={`
            absolute bottom-0
            ${layout === 'vertical' ? 'left-6' : 'md:left-1/2 md:transform md:-translate-x-1/2'}
            max-md:left-6
          `}
          initial={{ scale: 0 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: items.length * 0.1 }}
        >
          <div className={`
            w-4 h-4 rounded-full border-2 border-white shadow-lg z-10 relative
            bg-gradient-to-br from-${accentColor}-400 to-${accentColor}-600
          `} />
        </motion.div>
      </div>
    </div>
  );
}

// Horizontal Timeline Variant
interface HorizontalTimelineProps {
  items: TimelineItem[];
  accentColor?: string;
  className?: string;
}

export function HorizontalTimeline({ 
  items, 
  accentColor = 'blue',
  className = '' 
}: HorizontalTimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div 
        ref={scrollRef}
        className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-hide"
      >
        {items.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            className="flex-shrink-0 w-80 snap-center"
          >
            <div className={`
              relative bg-white rounded-lg p-6 h-full
              border border-gray-100 shadow-sm hover:shadow-md
              transition-all duration-300
            `}>
              {/* Timeline Connector */}
              {index < items.length - 1 && (
                <div className={`
                  absolute top-1/2 -right-6 w-6 h-[2px]
                  bg-${accentColor}-200
                `} />
              )}
              
              {/* Dot */}
              <div className={`
                absolute -top-2 left-6 w-4 h-4 rounded-full
                bg-${accentColor}-500 border-2 border-white shadow-md
              `} />
              
              {/* Content */}
              <div className="pt-2">
                <span className={`
                  text-xs font-medium tracking-wider
                  text-${accentColor}-600
                `}>
                  {item.date}
                </span>
                <h3 className="text-lg font-medium mt-2 mb-3">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.description}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
      
      {/* Gradient Overlays for scroll indication */}
      <div className="absolute left-0 top-0 bottom-0 w-20 bg-gradient-to-r from-white to-transparent pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-l from-white to-transparent pointer-events-none" />
    </div>
  );
}
