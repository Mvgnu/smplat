# CMS Assessment and Tasks

## Current Capabilities
- Auth + Users (local strategy)
- Admin UI at /admin with Payload 3.61 (Next 15)
- Collections:
  - Pages (sections, testimonials, pricing tiers, lexical marketing content)
  - BlogPosts, CaseStudies, FAQs, PricingTiers, Testimonials, SiteSettings
  - CheckoutTrustExperiences (storefront trust content)
- REST and GraphQL API mounted under /api
- Web storefront integrates CMS content (marketing/pages) via Next server loaders

## Known Gaps
- Media uploads: No `Media` collection configured → no image/file upload UI
- No image fields referencing a Media library in Pages/Posts/etc.

## Recommended Tasks (Media Support)
1. Add `Media` collection (uploads enabled)
   - Storage: start with local filesystem; plan for S3-compatible in envs
   - Thumbnails/sizes: basic responsive presets
2. Wire image/file fields
   - Pages: hero images, section images (reference Media)
   - BlogPosts/CaseStudies: cover image (reference Media)
   - Testimonials: avatar (reference Media)
3. Configure access rules
   - Read: public
   - Write/update/delete: `canWrite` access
4. Update importMap/types
   - Regenerate Payload types and import map after schema changes
5. Frontend integration
   - Update web loaders/types to resolve Media URLs
   - Ensure og:image and SEO fields can use Media assets
6. Ops
   - Add env switches for local vs S3 storage
   - Document image constraints and size guidelines

## Out of Scope (for now)
- DAM features beyond basic uploads (transformations, metadata taxonomy)
