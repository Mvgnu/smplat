'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

type Testimonial = {
  quote: string;
  author: string;
  role?: string;
  company?: string;
  avatarUrl?: string;
  rating?: number;
  featured?: boolean;
};

type TestimonialGridProps = {
  kicker?: string;
  heading?: string;
  subheading?: string;
  layout?: 'grid' | 'masonry';
  testimonials: Testimonial[];
};

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-1 mb-4">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`w-5 h-5 ${star <= rating ? 'text-yellow-400' : 'text-gray-300'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

export function TestimonialGrid({
  kicker,
  heading,
  subheading,
  layout = 'grid',
  testimonials
}: TestimonialGridProps) {
  if (!testimonials || testimonials.length === 0) {
    return null;
  }

  // Sort to put featured testimonials first
  const sortedTestimonials = [...testimonials].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return 0;
  });

  return (
    <section className="py-16 md:py-24 px-4 bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        {(kicker || heading || subheading) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16 max-w-3xl mx-auto"
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
              <p className="text-lg text-gray-600 leading-relaxed">
                {subheading}
              </p>
            )}
          </motion.div>
        )}

        {/* Testimonials Grid */}
        <div
          className={
            layout === 'masonry'
              ? 'columns-1 md:columns-2 lg:columns-3 gap-6 space-y-6'
              : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
          }
        >
          {sortedTestimonials.map((testimonial, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              className={`
                ${layout === 'masonry' ? 'break-inside-avoid mb-6' : ''}
                relative bg-white rounded-xl p-6 md:p-8 shadow-sm hover:shadow-md transition-all duration-300
                ${testimonial.featured ? 'ring-2 ring-blue-400 scale-105' : 'border border-gray-200'}
              `}
            >
              {/* Featured Badge */}
              {testimonial.featured && (
                <div className="absolute -top-3 -right-3 bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full shadow-md">
                  Featured
                </div>
              )}

              {/* Rating */}
              {testimonial.rating && <StarRating rating={testimonial.rating} />}

              {/* Quote */}
              <blockquote className="text-gray-700 leading-relaxed mb-6">
                <span className="text-4xl text-blue-200 leading-none">&ldquo;</span>
                <p className="mt-2">{testimonial.quote}</p>
              </blockquote>

              {/* Author Info */}
              <div className="flex items-center gap-4 pt-6 border-t border-gray-100">
                {testimonial.avatarUrl ? (
                  <div className="relative w-12 h-12 rounded-full overflow-hidden flex-shrink-0">
                    <Image
                      src={testimonial.avatarUrl}
                      alt={testimonial.author}
                      fill
                      className="object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-blue-600 font-semibold text-lg">
                      {testimonial.author.charAt(0)}
                    </span>
                  </div>
                )}

                <div>
                  <p className="font-semibold text-gray-900">
                    {testimonial.author}
                  </p>
                  {(testimonial.role || testimonial.company) && (
                    <p className="text-sm text-gray-600">
                      {testimonial.role}
                      {testimonial.role && testimonial.company && ' at '}
                      {testimonial.company}
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
