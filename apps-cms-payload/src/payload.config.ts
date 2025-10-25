import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig } from "payload";

import { BlogPosts } from "@/collections/BlogPosts";
import { CaseStudies } from "@/collections/CaseStudies";
import { Faqs } from "@/collections/Faqs";
import { Pages } from "@/collections/Pages";
import { PricingTiers } from "@/collections/PricingTiers";
import { SiteSettings } from "@/collections/SiteSettings";
import { Testimonials } from "@/collections/Testimonials";
import { Users } from "@/collections/Users";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

dotenv.config({ path: path.resolve(dirname, "../.env"), override: false });
dotenv.config({ path: path.resolve(dirname, "../../.env"), override: false });

const DATABASE_URI = process.env.DATABASE_URI || "postgres://postgres:postgres@localhost:5432/smplat_payload";
const WEB_ORIGIN = process.env.WEB_URL || "http://localhost:3000";

export default buildConfig({
  serverURL: process.env.PAYLOAD_URL || "http://localhost:3050",
  secret: process.env.PAYLOAD_SECRET || "smplat-dev-secret",
  admin: {
    user: Users.slug,
    importMap: {
      importMapFile: path.resolve(dirname, "../importMap.js")
    }
  },
  editor: lexicalEditor(),
  collections: [Users, Pages, BlogPosts, Faqs, Testimonials, CaseStudies, PricingTiers, SiteSettings],
  cors: [WEB_ORIGIN],
  csrf: [WEB_ORIGIN],
  typescript: {
    outputFile: path.resolve(dirname, "../payload-types.ts")
  },
  graphQL: {
    disablePlaygroundInProduction: false
  },
  db: postgresAdapter({
    pool: {
      connectionString: DATABASE_URI
    }
  }),
  onInit: async (payload) => {
    if (!process.env.DEFAULT_ADMIN_EMAIL || !process.env.DEFAULT_ADMIN_PASSWORD) {
      return;
    }

    const existing = await payload.find({
      collection: Users.slug,
      where: {
        email: {
          equals: process.env.DEFAULT_ADMIN_EMAIL
        }
      },
      limit: 1
    });

    if (existing.totalDocs === 0) {
      await payload.create({
        collection: Users.slug,
        data: {
          email: process.env.DEFAULT_ADMIN_EMAIL,
          password: process.env.DEFAULT_ADMIN_PASSWORD,
          name: "Payload Admin"
        }
      });
    }
  }
});
