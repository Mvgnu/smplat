'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';

type TextImageTextProps = {
  kicker?: string;
  heading?: string;
  bodyText: string;
  imageUrl: string;
  imageAlt?: string;
  imageSide?: 'left' | 'right';
  imageSticky?: boolean;
};

export function TextImageText({
  kicker,
  heading,
  bodyText,
  imageUrl,
  imageAlt = 'Content image',
  imageSide = 'right',
  imageSticky = false
}: TextImageTextProps) {
  const imageOnLeft = imageSide === 'left';

  return (
    <section className="py-16 md:py-24 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-start">
          {/* Text Content */}
          <motion.div
            initial={{ opacity: 0, x: imageOnLeft ? 20 : -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className={`${imageOnLeft ? 'lg:order-2' : 'lg:order-1'} space-y-6`}
          >
            {/* Kicker */}
            {kicker && (
              <div className="flex items-center">
                <div className="w-12 h-px bg-blue-500 mr-4" />
                <span className="text-blue-600 uppercase tracking-widest text-xs font-medium">
                  {kicker}
                </span>
              </div>
            )}

            {/* Heading */}
            {heading && (
              <h2 className="text-3xl md:text-4xl font-light tracking-tight text-gray-900 leading-tight">
                {heading}
              </h2>
            )}

            {/* Body Text */}
            <div className="prose prose-lg max-w-none">
              {bodyText.split('\n\n').map((paragraph, index) => (
                paragraph.trim() && (
                  <p key={index} className="text-gray-600 leading-relaxed mb-4">
                    {paragraph}
                  </p>
                )
              ))}
            </div>
          </motion.div>

          {/* Image */}
          <motion.div
            initial={{ opacity: 0, x: imageOnLeft ? -20 : 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className={`${imageOnLeft ? 'lg:order-1' : 'lg:order-2'} ${imageSticky ? 'lg:sticky lg:top-24' : ''}`}
          >
            <div className="relative aspect-[4/3] rounded-2xl overflow-hidden shadow-lg">
              <Image
                src={imageUrl}
                alt={imageAlt}
                fill
                className="object-cover transition-transform duration-700 hover:scale-105"
              />

              {/* Decorative border effect */}
              <div className="absolute inset-0 rounded-2xl border-4 border-white/20 pointer-events-none" />
            </div>

            {/* Decorative elements */}
            <div className={`absolute -z-10 w-72 h-72 bg-blue-100 rounded-full blur-3xl opacity-20 ${imageOnLeft ? '-left-24' : '-right-24'} -bottom-24`} />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
