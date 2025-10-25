import { cache } from "react";
import type { SanityDocument } from "@sanity/client";

import { getClient, isPayload, payloadFetch } from "./client";
import { payloadConfig } from "./config";
import { blogPostBySlugQuery, blogPostsQuery, homepageQuery, pageBySlugQuery } from "./queries";
import { blogPostDetailSchema, blogPostListSchema, pageSchema, type BlogPostSummary, type PageDocument } from "./types";

const parsePage = (data: SanityDocument | null): PageDocument | null => {
  if (!data) {
    return null;
  }

  const result = pageSchema.safeParse(data);
  if (!result.success) {
    console.warn("Failed to parse Sanity page document", result.error.flatten());
    return null;
  }

  return result.data;
};

export const getHomepage = cache(async (preview = false): Promise<PageDocument | null> => {
  try {
    if (isPayload()) {
      // GET /api/pages?where[slug][equals]=home&where[environment][equals]=env&depth=2
      const env = payloadConfig.environment;
      const data = await payloadFetch<{ docs: SanityDocument[] }>({
        path: "/api/pages",
        query: {
          "where[slug][equals]": "home",
          "where[environment][equals]": env,
          depth: 2
        }
      });
      return parsePage(data.docs?.[0] || null);
    } else {
      const client = getClient(preview);
      const data = await client.fetch(homepageQuery);
      return parsePage(data);
    }
  } catch (error) {
    console.warn("Failed to fetch homepage from Sanity, using fallback data:", error);
    return null;
  }
});

export const getPageBySlug = cache(async (slug: string, preview = false): Promise<PageDocument | null> => {
  if (isPayload()) {
    const env = payloadConfig.environment;
    const data = await payloadFetch<{ docs: SanityDocument[] }>({
      path: "/api/pages",
      query: {
        "where[slug][equals]": slug,
        "where[environment][equals]": env,
        depth: 2
      }
    });
    return parsePage(data.docs?.[0] || null);
  } else {
    const client = getClient(preview);
    const data = await client.fetch(pageBySlugQuery, { slug });
    return parsePage(data);
  }
});

export const getBlogPosts = cache(async (preview = false): Promise<BlogPostSummary[]> => {
  try {
    if (isPayload()) {
      const env = payloadConfig.environment;
      const data = await payloadFetch<{ docs: unknown[] }>({
        path: "/api/blog-posts",
        query: {
          sort: "-publishedAt",
          "where[environment][equals]": env
        }
      });
      const parsed = blogPostListSchema.safeParse(data.docs ?? []);
      if (!parsed.success) {
        console.warn("Failed to parse blog post documents", parsed.error.flatten());
        return [];
      }
      return parsed.data;
    }
    const client = getClient(preview);
    const data = await client.fetch(blogPostsQuery);
    const parsed = blogPostListSchema.safeParse(data);
    if (!parsed.success) {
      console.warn("Failed to parse blog post documents", parsed.error.flatten());
      return [];
    }
    return parsed.data;
  } catch (error) {
    console.warn("Failed to fetch blog posts from Sanity, using fallback data:", error);
    return [];
  }
});

export const getBlogPostBySlug = cache(async (slug: string, preview = false) => {
  if (isPayload()) {
    const env = payloadConfig.environment;
    const data = await payloadFetch<{ docs: unknown[] }>({
      path: "/api/blog-posts",
      query: {
        "where[slug][equals]": slug,
        "where[environment][equals]": env
      }
    });
    const parsed = blogPostDetailSchema.safeParse(data.docs?.[0] ?? null);
    if (!parsed.success) {
      console.warn("Failed to parse blog post", parsed.error.flatten());
      return null;
    }
    return parsed.data;
  }
  const client = getClient(preview);
  const data = await client.fetch(blogPostBySlugQuery, { slug });
  const parsed = blogPostDetailSchema.safeParse(data);
  if (!parsed.success) {
    console.warn("Failed to parse blog post", parsed.error.flatten());
    return null;
  }
  return parsed.data;
});
