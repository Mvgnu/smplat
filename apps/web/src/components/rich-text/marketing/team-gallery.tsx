'use client';

import { motion } from 'framer-motion';
import Image from 'next/image';
import { useState } from 'react';

type TeamMember = {
  name: string;
  role: string;
  department?: string;
  bio?: string;
  imageUrl: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  emailUrl?: string;
};

type TeamGalleryProps = {
  kicker?: string;
  heading?: string;
  subheading?: string;
  columns?: '2' | '3' | '4';
  members: TeamMember[];
};

const columnClasses = {
  '2': 'md:grid-cols-2',
  '3': 'md:grid-cols-2 lg:grid-cols-3',
  '4': 'md:grid-cols-2 lg:grid-cols-4'
};

function TeamMemberCard({ member, index }: { member: TeamMember; index: number }) {
  const [showBio, setShowBio] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="group relative bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-100"
      onMouseEnter={() => member.bio && setShowBio(true)}
      onMouseLeave={() => setShowBio(false)}
    >
      {/* Image */}
      <div className="relative aspect-square overflow-hidden bg-gray-100">
        <Image
          src={member.imageUrl}
          alt={member.name}
          fill
          className="object-cover transition-transform duration-700 group-hover:scale-110"
        />

        {/* Bio Overlay */}
        {member.bio && (
          <motion.div
            initial={false}
            animate={{
              opacity: showBio ? 1 : 0,
              y: showBio ? 0 : 20
            }}
            transition={{ duration: 0.3 }}
            className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent flex items-end p-6"
          >
            <p className="text-white text-sm leading-relaxed">
              {member.bio}
            </p>
          </motion.div>
        )}

        {/* Department Badge */}
        {member.department && (
          <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full">
            <span className="text-xs font-medium text-gray-700">
              {member.department}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          {member.name}
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          {member.role}
        </p>

        {/* Social Links */}
        {(member.linkedinUrl || member.twitterUrl || member.emailUrl) && (
          <div className="flex gap-3">
            {member.linkedinUrl && (
              <a
                href={member.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-blue-100 flex items-center justify-center transition-colors duration-300 group/link"
                aria-label={`${member.name} on LinkedIn`}
              >
                <svg
                  className="w-4 h-4 text-gray-600 group-hover/link:text-blue-600"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
              </a>
            )}

            {member.twitterUrl && (
              <a
                href={member.twitterUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-blue-100 flex items-center justify-center transition-colors duration-300 group/link"
                aria-label={`${member.name} on Twitter`}
              >
                <svg
                  className="w-4 h-4 text-gray-600 group-hover/link:text-blue-600"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z" />
                </svg>
              </a>
            )}

            {member.emailUrl && (
              <a
                href={member.emailUrl}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-blue-100 flex items-center justify-center transition-colors duration-300 group/link"
                aria-label={`Email ${member.name}`}
              >
                <svg
                  className="w-4 h-4 text-gray-600 group-hover/link:text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </a>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function TeamGallery({
  kicker,
  heading,
  subheading,
  columns = '3',
  members
}: TeamGalleryProps) {
  if (!members || members.length === 0) {
    return null;
  }

  return (
    <section className="py-16 md:py-24 px-4">
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

        {/* Team Grid */}
        <div className={`grid grid-cols-1 ${columnClasses[columns]} gap-8`}>
          {members.map((member, index) => (
            <TeamMemberCard key={index} member={member} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
