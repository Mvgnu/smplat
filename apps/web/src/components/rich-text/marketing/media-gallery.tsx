// meta: marketing-block: media-gallery

import Image from "next/image";

type MediaItem = {
  kind?: "image" | "video";
  src?: string;
  alt?: string;
  caption?: string;
  poster?: string;
};

type MediaGalleryProps = {
  heading?: string;
  subheading?: string;
  media: MediaItem[];
  columns?: number;
};

const resolveGalleryColumns = (columns?: number) => {
  if (!columns || columns <= 2) {
    return "md:grid-cols-2";
  }

  if (columns >= 4) {
    return "lg:grid-cols-4";
  }

  return "lg:grid-cols-3";
};

export function MediaGallery({ heading, subheading, media, columns }: MediaGalleryProps) {
  const validMedia = media.filter((item): item is MediaItem & { src: string } => !!item.src);

  if (validMedia.length === 0) {
    return null;
  }

  const columnClass = resolveGalleryColumns(columns);

  return (
    <section className="space-y-6">
      {heading ? <h3 className="text-2xl font-semibold text-white">{heading}</h3> : null}
      {subheading ? <p className="max-w-3xl text-white/70">{subheading}</p> : null}
      <div className={`grid gap-6 sm:grid-cols-2 ${columnClass}`}>
        {validMedia.map((item, index) => {
          const isVideo = item.kind === "video";

          return (
            <figure
              key={item.src ?? index}
              className="overflow-hidden rounded-3xl border border-white/10 bg-white/5"
            >
              {isVideo ? (
                <video
                  className="aspect-video h-full w-full"
                  controls
                  poster={item.poster}
                  preload="metadata"
                >
                  <source src={item.src} />
                  {item.caption ?? "Your browser does not support the video tag."}
                </video>
              ) : (
                <div className="relative aspect-video w-full">
                  <Image
                    src={item.src}
                    alt={item.alt ?? "Marketing media"}
                    fill
                    className="object-cover"
                    sizes="(min-width: 1024px) 25rem, (min-width: 640px) 50vw, 100vw"
                  />
                </div>
              )}
              {item.caption ? (
                <figcaption className="px-4 py-3 text-sm text-white/70">{item.caption}</figcaption>
              ) : null}
            </figure>
          );
        })}
      </div>
    </section>
  );
}

export type { MediaItem };
