/** @jest-environment node */

import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";

const draftState: { isEnabled: boolean } = { isEnabled: false };

type PayloadCollectionResponse<T> = {
  docs?: T[];
};

type PayloadBlogDoc = {
  id?: string;
  _id?: string;
  title?: string;
};

jest.mock("next/headers", () => ({
  draftMode: () => draftState
}));

const integrationUrl = process.env.PAYLOAD_INTEGRATION_URL;

const runIntegration = Boolean(integrationUrl);
const testOrSkip = runIntegration ? it : it.skip;

if (!runIntegration) {
  describe("payload integration", () => {
    testOrSkip("requires PAYLOAD_INTEGRATION_URL", () => {
      expect(true).toBe(true);
    });
  });
} else {
  describe("payload integration", () => {
    const originalEnv = process.env;

    beforeAll(() => {
      jest.setTimeout(30000);
      process.env = {
        ...originalEnv,
        CMS_PROVIDER: "payload",
        PAYLOAD_URL: integrationUrl,
        PAYLOAD_API_TOKEN: process.env.PAYLOAD_INTEGRATION_TOKEN ?? originalEnv.PAYLOAD_API_TOKEN,
        CMS_ENV: process.env.PAYLOAD_INTEGRATION_ENV ?? originalEnv.CMS_ENV ?? "test",
        PAYLOAD_PREVIEW_SECRET:
          process.env.PAYLOAD_INTEGRATION_PREVIEW_SECRET ?? originalEnv.PAYLOAD_PREVIEW_SECRET
      };
    });

    afterAll(() => {
      process.env = originalEnv;
      draftState.isEnabled = false;
    });

    testOrSkip("fetches homepage, page, and blog post end-to-end", async () => {
      const { fetchHomepage, getPageBySlug, getBlogPostBySlug } = await import("../loaders");

      const homepage = await fetchHomepage();
      expect(homepage).toBeTruthy();
      expect(homepage?.title).toBeTruthy();

      const page = await getPageBySlug("home");
      expect(page).toBeTruthy();

      const blogPost = await getBlogPostBySlug("sample-post");
      expect(blogPost).toBeTruthy();
    });

    testOrSkip("resolves payload draft blog posts when preview is enabled", async () => {
      const { payloadGet, payloadPatch } = await import("../client");
      const { getBlogPostBySlug } = await import("../loaders");

      const environment = process.env.CMS_ENV ?? "test";
      const slug = process.env.PAYLOAD_INTEGRATION_DRAFT_SLUG ?? "automation-workflows";

      const response = await payloadGet<PayloadCollectionResponse<Record<string, unknown>>>({
        path: "/api/blog-posts",
        query: {
          "where[slug][equals]": slug,
          "where[environment][equals]": environment,
          limit: 1
        }
      });

      const doc = (Array.isArray(response.docs) ? response.docs[0] : undefined) as PayloadBlogDoc | undefined;
      expect(doc).toBeTruthy();

      const docId = doc?.id ?? doc?._id;
      expect(docId).toBeTruthy();

      const originalTitle = doc?.title;
      expect(originalTitle).toBeTruthy();

      if (!docId || !originalTitle) {
        throw new Error("Missing payload blog identifiers");
      }

      const draftTitle = `${originalTitle} (preview ${Date.now()})`;

      draftState.isEnabled = true;
      await payloadPatch({
        path: `/api/blog-posts/${docId}`,
        body: { title: draftTitle },
        query: { draft: "true" }
      });

      try {
        draftState.isEnabled = false;
        const published = await getBlogPostBySlug(slug);
        expect(published?.title).toBe(originalTitle);

        draftState.isEnabled = true;
        const preview = await getBlogPostBySlug(slug, true);
        expect(preview?.title).toBe(draftTitle);
      } finally {
        draftState.isEnabled = true;
        await payloadPatch({
          path: `/api/blog-posts/${docId}`,
          body: { title: originalTitle },
          query: { draft: "true" }
        });
        draftState.isEnabled = false;
      }
    });
  });
}
