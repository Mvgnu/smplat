/** @jest-environment node */

import { describe, expect, it, beforeAll, afterAll, jest } from "@jest/globals";

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
        CMS_ENV: process.env.PAYLOAD_INTEGRATION_ENV ?? originalEnv.CMS_ENV ?? "test"
      };
    });

    afterAll(() => {
      process.env = originalEnv;
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
  });
}
