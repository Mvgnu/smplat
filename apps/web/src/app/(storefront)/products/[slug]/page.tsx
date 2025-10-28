import { Metadata } from "next";
import Link from "next/link";
import type { ResolvingMetadata } from "next";

import { getCheckoutTrustExperience } from "@/server/cms/trust";
import { getPageBySlug } from "@/server/cms/loaders";
import type { CheckoutMetricVerification, CheckoutTrustExperience } from "@/server/cms/trust";
import type { PageDocument } from "@/server/cms/types";
import { ProductDetail } from "@/types/product";

import { ProductDetailClient } from "./product-detail-client";
import {
  defaultMarketing,
  marketingFallbacks,
  type MarketingContent,
  type GalleryItem,
  type Metric,
  type Review,
  type Bundle,
} from "../marketing-content";

const trustAlertDescriptions: Record<string, string> = {
  sla_breach_risk: "Projected clearance exceeds the guaranteed delivery SLA.",
  sla_watch: "Operators are tracking elevated backlog depth.",
  limited_history: "Forecast is calibrating from a limited completion sample.",
  forecast_unavailable: "Forecast temporarily offline – showing fallback narrative.",
  no_staffing_capacity: "No upcoming staffing capacity windows are scheduled.",
  partial_support: "Only a subset of SKUs currently have staffed coverage.",
};

const apiBase =
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

type PageProps = {
  params: { slug: string };
};

function mergeMarketingContent(fallback: MarketingContent, page: PageDocument | null | undefined): MarketingContent {
  if (!page) {
    return fallback;
  }

  const heroEyebrow = page.hero?.eyebrow ?? fallback.heroEyebrow;
  const heroSubheadline = page.hero?.subheadline ?? fallback.heroSubheadline;

  const metrics =
    page.content?.flatMap((section) =>
      section._type === "section" && Array.isArray(section.metrics)
        ? section.metrics.map((metric) => ({
            label: metric.label,
            value: metric.value,
            caption: metric.description,
          }))
        : []
    ) ?? [];

  const reviews =
    page.content?.flatMap((section) =>
      section._type === "section" && Array.isArray(section.testimonials)
        ? section.testimonials.map((testimonial) => ({
            id: `${testimonial.author ?? testimonial.company ?? "testimonial"}-${testimonial.quote.slice(0, 12)}`,
            author: testimonial.author ?? testimonial.company ?? "Client",
            role: testimonial.role,
            rating: 5,
            highlight: testimonial.quote,
          }))
        : []
    ) ?? [];

  const faqs =
    page.content?.flatMap((section) =>
      section._type === "section" && Array.isArray(section.faqItems)
        ? section.faqItems.map((faq) => ({
            question: faq.question,
            answer: faq.answer,
          }))
        : []
    ) ?? [];

  const featureHighlights =
    page.content?.flatMap((section) => {
      if (section._type !== "section") {
        return [];
      }
      if (section.metrics?.length || section.testimonials?.length) {
        return [];
      }
      const heading = section.heading ?? undefined;
      const description = section.subheading ?? undefined;
      if (!heading && !description) {
        return [];
      }
      return [
        {
          title: heading ?? description ?? "",
          description: description ?? heading ?? "",
        },
      ];
    }) ?? [];

  const benefits =
    page.content?.flatMap((section) =>
      section._type === "section" && Array.isArray(section.content)
        ? section.content
            .filter((item): item is string => typeof item === "string")
            .map((item) => item)
        : []
    ) ?? [];

  const galleryCandidates =
    page.content?.flatMap((section) => {
      if (section._type !== "section" || !Array.isArray(section.content)) {
        return [];
      }
      return section.content
        .map((item: unknown) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const candidate = item as Record<string, unknown>;
          const imageUrl =
            typeof candidate["imageUrl"] === "string"
              ? (candidate["imageUrl"] as string)
              : typeof candidate["url"] === "string"
                ? (candidate["url"] as string)
                : typeof candidate["asset"] === "object" &&
                  candidate["asset"] !== null &&
                  typeof (candidate["asset"] as Record<string, unknown>)["url"] === "string"
                  ? ((candidate["asset"] as Record<string, unknown>)["url"] as string)
                  : undefined;
          if (!imageUrl) {
            return null;
          }
          const id =
            (typeof candidate["_key"] === "string" && candidate["_key"]) ||
            (typeof candidate["id"] === "string" && candidate["id"]) ||
            imageUrl;
          const title =
            typeof candidate["title"] === "string"
              ? (candidate["title"] as string)
              : typeof candidate["heading"] === "string"
                ? (candidate["heading"] as string)
                : undefined;
          const description =
            typeof candidate["caption"] === "string"
              ? (candidate["caption"] as string)
              : typeof candidate["description"] === "string"
                ? (candidate["description"] as string)
                : undefined;
          const galleryItem: GalleryItem = {
            id,
            title,
            description,
            imageUrl,
          };
          return galleryItem;
        })
        .filter((item): item is GalleryItem => Boolean(item));
    }) ?? [];
  const gallery: GalleryItem[] = galleryCandidates;

  return {
    ...fallback,
    heroEyebrow,
    heroSubheadline,
    metrics: metrics.length > 0 ? metrics : fallback.metrics,
    reviews: reviews.length > 0 ? reviews : fallback.reviews,
    faqs: faqs.length > 0 ? faqs : fallback.faqs,
    featureHighlights:
      featureHighlights.length > 0 ? featureHighlights : fallback.featureHighlights,
    benefits: benefits.length > 0 ? benefits : fallback.benefits,
    gallery: gallery.length > 0 ? gallery : fallback.gallery,
  };
}

function integrateTrustSignals(
  marketing: MarketingContent,
  trust: CheckoutTrustExperience | null | undefined,
): MarketingContent {
  if (!trust) {
    return marketing;
  }

  const metrics = [...marketing.metrics];
  trust.performanceSnapshots.forEach((snapshot) => {
    const label = snapshot.label?.trim();
    if (!label) {
      return;
    }

    const metric = snapshot.metric as CheckoutMetricVerification | undefined;
    const resolvedValue =
      metric?.formattedValue ?? snapshot.value ?? snapshot.fallbackValue ?? null;
    if (!resolvedValue) {
      return;
    }

    const fallbackCaption = metric?.fallbackCopy ?? undefined;
    const alertCaption = metric?.alerts
      ?.map((code) => (typeof code === "string" ? trustAlertDescriptions[code] ?? null : null))
      .find((message) => Boolean(message)) ?? null;
    const caption = fallbackCaption ?? snapshot.caption ?? metric?.provenanceNote ?? alertCaption ?? undefined;

    const replacement = { label, value: resolvedValue, caption } satisfies Metric;
    const existingIndex = metrics.findIndex((item) => item.label === label);
    if (existingIndex >= 0) {
      metrics[existingIndex] = replacement;
    } else {
      metrics.push(replacement);
    }
  });

  const reviews = [...marketing.reviews];
  trust.testimonials.forEach((testimonial) => {
    if (!testimonial.quote?.trim()) {
      return;
    }
    const id = testimonial.id ?? testimonial.author ?? `testimonial-${reviews.length + 1}`;
    const replacement = {
      id,
      author: testimonial.author ?? "Client",
      role: testimonial.role ?? undefined,
      rating: 5,
      highlight: testimonial.quote,
    } satisfies Review;
    const index = reviews.findIndex((review) => review.id === id);
    if (index >= 0) {
      reviews[index] = replacement;
    } else {
      reviews.push(replacement);
    }
  });

  const bundles = [...marketing.bundles];
  trust.bundleOffers.forEach((bundle) => {
    if (!bundle.slug?.trim()) {
      return;
    }
    const replacement = {
      slug: bundle.slug,
      title: bundle.title,
      description: bundle.description,
      savings: bundle.savings ?? undefined,
    } satisfies Bundle;
    const index = bundles.findIndex((item) => item.slug === bundle.slug);
    if (index >= 0) {
      bundles[index] = replacement;
    } else {
      bundles.push(replacement);
    }
  });

  return {
    ...marketing,
    metrics,
    reviews,
    bundles,
  };
}

async function fetchProduct(slug: string): Promise<ProductDetail | null> {
  try {
    const response = await fetch(`${apiBase}/api/v1/products/${slug}`, {
      cache: "no-store"
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch product: ${response.status}`);
    }

    const product = (await response.json()) as ProductDetail;
    if (product.status.toLowerCase() != "active") {
      return null;
    }

    return product;
  } catch (error) {
    console.error("Error fetching product:", error);
    return null;
  }
}

export async function generateMetadata(
  { params }: PageProps,
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const product = await fetchProduct(params.slug);

  if (!product) {
    return {
      title: "Service Not Found | SMPLAT"
    };
  }

  const cmsSlug = `product-${product.slug}`;
  const page = await getPageBySlug(cmsSlug);
  const fallback = marketingFallbacks[product.slug] ?? defaultMarketing;
  const trustExperience = await getCheckoutTrustExperience();
  const marketing = integrateTrustSignals(mergeMarketingContent(fallback, page), trustExperience);

  return {
    title: `${product.title} | SMPLAT`,
    description:
      product.description ??
      marketing.heroSubheadline ??
      `Premium ${product.category} service from SMPLAT. Learn more about ${product.title}.`,
    openGraph: {
      title: product.title,
      description:
        product.description ??
        marketing.heroSubheadline ??
        `Premium ${product.category} service from SMPLAT. Learn more about ${product.title}.`
    }
  };
}

export default async function ProductDetailPage({ params }: PageProps) {
  const product = await fetchProduct(params.slug);

  if (!product) {
    return (
      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-24 text-white">
        <section className="rounded-3xl border border-white/10 bg-white/5 p-12 text-center backdrop-blur">
          <h1 className="text-4xl font-semibold">Service Unavailable</h1>
          <p className="mt-4 text-white/70">
            The service you&apos;re looking for cannot be found or is no longer active.
          </p>
          <div className="mt-8">
            <Link
              href="/products"
              className="inline-flex items-center rounded-full bg-white px-6 py-2 text-sm font-semibold text-black transition hover:bg-white/90"
            >
              Back to Services
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const cmsSlug = `product-${product.slug}`;
  const page = await getPageBySlug(cmsSlug);
  const fallback = marketingFallbacks[product.slug] ?? defaultMarketing;
  const trustExperience = await getCheckoutTrustExperience();
  const marketing = integrateTrustSignals(mergeMarketingContent(fallback, page), trustExperience);

  return <ProductDetailClient product={product} marketing={marketing} />;
}
