# SMPLAT CMS and Component Architecture Analysis

## Executive Summary
The project uses **Payload CMS 3.x** (headless CMS) coupled with **Next.js 14+** for the frontend. Components are organized into themed directories with a clear separation between marketing components (rendered from Payload blocks) and functional components (admin, checkout, etc.). The system uses **Lexical rich text editor** with custom blocks for content management.

---

## 1. PAYLOAD CMS CONFIGURATION

### Main Config Location
**File**: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/payload.config.ts`

### Key Configuration Points:
- **Database**: PostgreSQL via `@payloadcms/db-postgres`
- **Rich Text Editor**: Lexical with `BlocksFeature` for custom content blocks
- **Collections**: 9 collections defined (Pages, BlogPosts, Faqs, etc.)
- **Routes**: Admin at `/admin`, API at `/api`
- **GraphQL**: Enabled for content queries

### Core Collections (8 collections)
Located in: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/collections/`

1. **Pages.ts** - Marketing pages with hero section + block-based content
2. **BlogPosts.ts** - Blog articles with Lexical rich text body
3. **Faqs.ts** - FAQ content
4. **Testimonials.ts** - Customer testimonials
5. **CaseStudies.ts** - Case study content
6. **PricingTiers.ts** - Pricing information
7. **SiteSettings.ts** - Global site settings
8. **CheckoutTrustExperiences.ts** - Trust-building content for checkout
9. **Users.ts** - Admin users

---

## 2. PAYLOAD BLOCKS ARCHITECTURE

### Block Definition System

**Location**: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/lexical/marketing.ts`

### Marketing Blocks (9 blocks)
These are Lexical editor blocks that content editors use in the Payload admin panel:

```
1. marketing-hero          - Hero callout with CTAs
2. marketing-metrics       - Metrics grid display
3. marketing-testimonial   - Testimonial callouts
4. marketing-product-card  - Product card display
5. marketing-timeline      - Timeline showcase
6. marketing-feature-grid  - Feature grid layout
7. marketing-media-gallery - Image/video gallery
8. marketing-cta-cluster   - CTA button clusters
9. marketing-comparison-table - Feature comparison tables
```

### Page-Level Blocks (2 blocks)
**Location**: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/collections/Pages.ts`

```
1. section     - Flexible section block with layout options:
                 - Two Column, Metrics, Case Study, FAQ, 
                 - Testimonials, Pricing, Blog
                 - Can include nested marketing blocks
                 
2. testimonial - Standalone testimonial block
```

### Block Field Pattern
Each block follows this structure:
```typescript
const blockName: Block = {
  slug: "unique-slug",
  labels: { singular: "...", plural: "..." },
  fields: [
    { name: "fieldName", type: "text/textarea/array/etc" }
  ]
}
```

---

## 3. COMPONENT ORGANIZATION IN apps/web

### Directory Structure
```
/apps/web/src/components/
├── admin/                 - Admin dashboard components
│   ├── admin-shell.tsx
│   ├── breadcrumbs.tsx
│   ├── data-table.tsx
│   ├── filter-pill.tsx
│   ├── kpi-card.tsx
│   ├── tab-nav.tsx
│   └── index.ts           - Barrel export
│
├── auth/                  - Authentication components
│   └── session-provider.tsx
│
├── blog/                  - Blog-related components
│   ├── post-list.tsx      - Blog post grid
│   ├── post-content.tsx   - Blog post detail
│   ├── post-list.stories.tsx (Storybook)
│   └── __tests__/
│
├── case-studies/          - Case study components
│   └── highlight.tsx
│
├── checkout/              - Checkout flow components
│   ├── checkout-button.tsx
│   ├── recovery-banner.tsx
│   └── __tests__/
│
├── dashboard/             - Dashboard components
│   └── billing/           - Billing dashboard
│
├── faq/                   - FAQ components
│   └── accordion.tsx
│
├── layout/                - Layout components
│   ├── main-nav.tsx       - Navigation bar
│   ├── site-footer.tsx    - Footer
│   └── index.ts
│
├── loyalty/               - Loyalty program components
│   └── nudge-rail.tsx
│
├── marketing/             - Marketing/content rendering
│   ├── sections.tsx       - Main section renderer
│   ├── preview/           - Live preview components
│   │   ├── BlockDiagnosticsPanel.tsx
│   │   ├── PreviewWorkbench.tsx
│   │   └── hooks/
│   └── __tests__/
│
├── navigation/            - Navigation components
│   └── header.tsx
│
├── pricing/               - Pricing components
│   ├── pricing-grid.tsx
│   └── pricing-grid.stories.tsx (Storybook)
│
├── products/              - Product components
│   ├── product-configurator.tsx
│   └── __tests__/
│
├── providers/             - Context/Provider components
│   └── QueryProvider.tsx
│
├── rich-text/             - Rich text rendering
│   ├── rich-text.tsx      - Main rich text renderer
│   ├── marketing-converters.tsx - Block converters
│   └── marketing/          - Marketing block components
│       ├── comparison-table.tsx
│       ├── cta-cluster.tsx
│       ├── feature-grid.tsx
│       ├── hero-callout.tsx
│       ├── media-gallery.tsx
│       ├── metric-grid.tsx
│       ├── product-card.tsx
│       ├── testimonial-callout.tsx
│       ├── timeline.tsx
│       └── README.md
│
└── testimonials/          - Testimonial components
    └── highlights.tsx
```

---

## 4. HOW COMPONENTS ARE CURRENTLY STRUCTURED

### Pattern 1: Marketing Blocks (Payload → React Components)

**Flow**:
```
Payload CMS Editor
    ↓ (Admin: /admin)
    ↓ (defines block: marketing-hero, marketing-metrics, etc.)
    ↓
Content fetched by web app
    ↓ (apps/web/src/server/cms/queries.ts)
    ↓
Type validation (Zod schemas)
    ↓ (apps/web/src/server/cms/types.ts)
    ↓
Rendering layer (sections.tsx)
    ↓ (switch/case on block type)
    ↓
React Components (rich-text/marketing/*.tsx)
    ↓ (render styled HTML)
```

**Example Component** (`/Users/magnusohle/cursorprojects/smplat/apps/web/src/components/rich-text/marketing/hero-callout.tsx`):
- Accepts props matching block schema
- Self-contained styling (Tailwind)
- No external dependencies beyond React & Next.js Link
- Handles optional fields gracefully

### Pattern 2: Lexical Block Converters

**Location**: `apps/web/src/components/rich-text/marketing-converters.tsx`

Payload's Lexical editor uses "converters" to transform serialized block nodes into React components:

```typescript
export const marketingLexicalConverters: JSXConverters = {
  blocks: {
    "marketing-hero": ({ node }) => <HeroCallout {...mapFields(node)} />,
    "marketing-metrics": ({ node }) => <MetricGrid {...mapFields(node)} />,
    // ... more converters
  }
}
```

### Pattern 3: Content Type Validation

**Location**: `apps/web/src/server/cms/types.ts`

Uses Zod discriminated unions to validate and type CMS content:
- `marketingContentSchema` - 9 different block types
- `pageSchema` - Pages with hero + content sections
- `blogPostDetailSchema` - Blog post with body
- etc.

This prevents runtime errors from malformed CMS data.

### Pattern 4: Section Rendering

**Location**: `apps/web/src/components/marketing/sections.tsx`

The main orchestrator that:
1. Takes Page content (array of blocks)
2. Discriminates on `_type` field
3. Renders appropriate component for each block type
4. Handles fallbacks and missing data gracefully

---

## 5. EXISTING PAYLOAD BLOCKS & COLLECTIONS

### Payload Block Configuration Hierarchy

```
payload.config.ts
├── lexicalEditor() with BlocksFeature
│   └── blocks: marketingBlocks (9 blocks)
│       └── Each block has: slug, labels, fields
│
└── collections: [
    └── Pages collection
        └── content: blocks field
            ├── Uses sectionBlock
            ├── Uses testimonialHighlightBlock
            └── Can contain: marketing blocks in nested richText
]
```

### Block Registration
Blocks are registered once in `payload.config.ts`:
```typescript
editor: lexicalEditor({
  features: ({ defaultFeatures }) => [
    ...defaultFeatures,
    BlocksFeature({ blocks: marketingBlocks })
  ]
})
```

---

## 6. CURRENT APPROACH FOR REUSABLE COMPONENTS

### Strategy 1: Component Composition
Marketing components accept minimal props matching their block schema:
- `HeroCallout`: eyebrow, headline, body, primaryCta, secondaryCta
- `MetricGrid`: heading, subheading, metrics[]
- `ProductCard`: badge, name, price, features[], ctaLabel, ctaHref

### Strategy 2: Styling via Tailwind
All components use Tailwind CSS classes:
- Dark theme (text-white, bg-white/5, etc.)
- Responsive design (md:, sm: prefixes)
- Reusable class patterns

### Strategy 3: Type Safety
Props are strongly typed:
```typescript
type HeroCalloutProps = {
  eyebrow?: string;
  headline?: string;
  body?: string;
  primaryCta?: CtaConfig;
  secondaryCta?: CtaConfig;
  align?: "start" | "center";
};
```

### Strategy 4: Storybook Documentation
Components have `.stories.tsx` files for visual documentation:
- `post-list.stories.tsx`
- `pricing-grid.stories.tsx`
- `accordion.stories.tsx`

### Strategy 5: Server-Side Validation
`apps/web/src/server/cms/types.ts` provides runtime validation:
- Zod schemas for all content types
- Type inference for React components
- Discriminated unions prevent invalid combinations

---

## 7. FIELD CUSTOMIZATION SYSTEM

### Environment Field
**Location**: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/fields/environment.ts`

Custom field for multi-environment content:
- Used in: Pages, BlogPosts, etc.
- Allows content isolation by environment

### Hooks System
**Location**: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/hooks/`

1. **revalidate.ts** - ISR (Incremental Static Regeneration)
   - Triggers Next.js revalidation on content changes
   - Keeps marketing pages fresh without full rebuild

2. **livePreview.ts** - Live Preview Publisher
   - Real-time content preview in Payload admin
   - Enables editors to see changes before publishing

---

## 8. KEY INTEGRATION POINTS

### apps-cms-payload → apps/web Data Flow

1. **Content Queries**
   - Location: `apps/web/src/server/cms/queries.ts`
   - Fetches from Payload REST/GraphQL API
   - Running on: `http://localhost:3050`

2. **Type Generation**
   - Payload generates: `payload-types.ts` in cms-payload
   - Web app imports: `server/cms/types.ts` (Zod validation layer)

3. **Live Preview System**
   - Payload publishes changes via webhooks/events
   - Web app subscribes to live preview events
   - Real-time content updates without page refresh

---

## RECOMMENDATIONS FOR NON-INTRUSIVE COMPONENT LIBRARY

### Integration Strategy

1. **Add Component Library Location**
   ```
   /packages/component-library/
   ├── src/
   │   ├── blocks/          ← New: CMS-aware components
   │   ├── ui/              ← New: Basic UI components
   │   ├── hooks/           ← New: Shared hooks
   │   └── types.ts         ← New: Shared types
   ├── package.json
   └── tsconfig.json
   ```

2. **Non-Intrusive Integration**
   - Don't modify existing components initially
   - Create new block types in parallel
   - Use Payload's `BlocksFeature` to register new blocks
   - Leverage existing converter pattern

3. **Extend Payload Blocks**
   ```typescript
   // apps-cms-payload/src/lexical/customBlocks.ts (NEW FILE)
   import { Block } from "payload";
   
   export const customBlocks: Block[] = [
     // New blocks here
   ];
   ```

4. **Register in Payload Config**
   ```typescript
   // payload.config.ts (MODIFY ONLY)
   BlocksFeature({
     blocks: [...marketingBlocks, ...customBlocks]
   })
   ```

5. **Create Converters**
   ```typescript
   // apps/web/src/components/rich-text/custom-converters.tsx (NEW FILE)
   export const customLexicalConverters: JSXConverters = {
     blocks: { /* ... */ }
   };
   ```

6. **Update Main Renderer**
   ```typescript
   // apps/web/src/components/marketing/sections.tsx (MINIMAL CHANGE)
   const converters = mergeConverters(
     marketingLexicalConverters, 
     customLexicalConverters  // Add this
   );
   ```

---

## SUMMARY OF KEY FILES

| Path | Purpose |
|------|---------|
| `apps-cms-payload/src/payload.config.ts` | Main CMS configuration |
| `apps-cms-payload/src/lexical/marketing.ts` | Block definitions |
| `apps-cms-payload/src/collections/Pages.ts` | Page collection with blocks |
| `apps/web/src/components/rich-text/marketing/` | React component implementations |
| `apps/web/src/components/rich-text/marketing-converters.tsx` | Payload → React converters |
| `apps/web/src/components/marketing/sections.tsx` | Content orchestrator |
| `apps/web/src/server/cms/types.ts` | Zod validation schemas |
| `apps/web/src/server/cms/queries.ts` | CMS data fetching |

