'use client';

import { motion } from 'framer-motion';

interface Project {
  title: string;
  category: string;
  description: string;
  image: string;
  stats: string[];
  url?: string;
  status: 'live' | 'coming-soon';
}

interface ProjectShowcaseProps {
  sectionBadge?: string;
  title: string;
  description?: string;
  projects: Project[];
  ctaText?: string;
  ctaHref?: string;
}

export default function ProjectShowcase({
  sectionBadge,
  title,
  description,
  projects,
  ctaText,
  ctaHref,
}: ProjectShowcaseProps) {
  return (
    <section className="py-32 bg-white">
      <div className="container mx-auto px-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-3xl mb-24"
        >
          {sectionBadge && (
            <div className="flex items-center mb-4">
              <div className="w-12 h-[1px] bg-blue-500 mr-4"></div>
              <span className="text-blue-500 uppercase tracking-widest text-xs font-medium">
                {sectionBadge}
              </span>
            </div>
          )}
          <h2 className="text-4xl md:text-5xl font-extralight mb-8">{title}</h2>
          {description && (
            <p className="text-gray-600 text-lg leading-relaxed">{description}</p>
          )}
        </motion.div>

        {/* Projects */}
        <div className="space-y-32">
          {projects.map((project, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.8 }}
              className={`flex flex-col ${index % 2 === 1 ? 'md:flex-row-reverse' : 'md:flex-row'} items-center gap-16`}
            >
              {/* Image */}
              <div className="w-full md:w-1/2">
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg shadow-md">
                  {project.status === 'coming-soon' ? (
                    <div className="absolute inset-0 bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center p-6">
                      <div className="relative w-full h-full">
                        {/* Grid pattern */}
                        <div className="absolute inset-0 opacity-10">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div key={`h-${i}`} className="absolute h-px w-full" style={{ top: `${20 * (i + 1)}%`, backgroundColor: '#6366f1', opacity: 0.7 - (i * 0.1) }}></div>
                          ))}
                          {Array.from({ length: 5 }).map((_, i) => (
                            <div key={`v-${i}`} className="absolute w-px h-full" style={{ left: `${20 * (i + 1)}%`, backgroundColor: '#6366f1', opacity: 0.7 - (i * 0.1) }}></div>
                          ))}
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center mb-4">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <p className="text-gray-600 font-medium">In Entwicklung</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <img
                      src={project.image}
                      alt={project.title}
                      className="w-full h-full object-cover transition-transform duration-1000 hover:scale-105"
                    />
                  )}
                  
                  {/* Status Badge */}
                  {project.status === 'coming-soon' ? (
                    <div className="absolute top-3 right-3 z-10 px-3 py-1 bg-amber-100 text-amber-600 text-xs font-medium rounded-full flex items-center">
                      <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mr-1.5 animate-pulse"></span>
                      Kommt bald
                    </div>
                  ) : (
                    <div className="absolute top-3 right-3 z-10 px-3 py-1 bg-green-100 text-green-600 text-xs font-medium rounded-full flex items-center">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5"></span>
                      Live
                    </div>
                  )}
                </div>
              </div>
              
              {/* Content */}
              <div className="w-full md:w-1/2">
                <div className="mb-6">
                  <span className="text-xs font-medium uppercase tracking-widest text-gray-500">
                    {project.category}
                  </span>
                  <h3 className="text-3xl font-light mt-2 mb-6">{project.title}</h3>
                  <div className="w-16 h-[1px] bg-gray-200 mb-6"></div>
                  <p className="text-gray-600 leading-relaxed mb-8">{project.description}</p>
                  
                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-4 mb-8">
                    {project.stats.map((stat, statIndex) => (
                      <div key={statIndex} className="text-center">
                        <div className="text-sm font-medium text-gray-900">{stat}</div>
                      </div>
                    ))}
                  </div>
                  
                  {/* CTA */}
                  {project.status === 'live' && project.url ? (
                    <a 
                      href={project.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="inline-flex items-center text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors group"
                    >
                      Projekt ansehen 
                      <span className="ml-2 group-hover:ml-3 transition-all duration-300">→</span>
                    </a>
                  ) : (
                    <span className="inline-flex items-center text-sm font-medium text-amber-600">
                      Bald verfügbar
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        {ctaText && ctaHref && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mt-20 py-12 border-t border-gray-100"
          >
            <div className="max-w-3xl mx-auto text-center">
              <div className="mb-6 relative inline-block">
                <div className="absolute -top-5 -left-5 w-10 h-10 bg-blue-100 rounded-full animate-pulse"></div>
                <div className="absolute -bottom-3 -right-3 w-6 h-6 bg-yellow-200 rounded-full"></div>
                <span className="relative text-3xl">💡</span>
              </div>
              <h3 className="text-2xl font-bold mb-4 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                Ihre Idee verdient Brillanz
              </h3>
              <p className="text-gray-600 mb-5 leading-relaxed max-w-xl mx-auto">
                Von der ersten Skizze bis zum letzten Pixel – wir bringen Ihre Vision mit Präzision zum Leben.
              </p>
              <div className="flex justify-center mb-8">
                <div className="w-12 h-1 bg-blue-500 rounded-full"></div>
              </div>
              <motion.a
                href={ctaHref}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.98 }}
                className="group relative overflow-hidden bg-blue-600 hover:bg-blue-700 text-white px-8 py-4 rounded-full shadow-lg transform transition-all duration-500 inline-flex items-center"
              >
                <span className="relative z-10">{ctaText}</span>
                <span className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-blue-500 transform scale-x-0 origin-left transition-transform duration-500 group-hover:scale-x-100"></span>
                <div className="absolute -right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 bg-white/20 rounded-full group-hover:translate-x-1 transition-transform"></div>
              </motion.a>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
