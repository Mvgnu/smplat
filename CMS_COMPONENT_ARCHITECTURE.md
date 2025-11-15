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

### Core Collections
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

### Component Directory Structure

**Location**: `/Users/magnusohle/cursorprojects/smplat/apps/web/src/components/`

Key directories:
- **admin/** - Admin dashboard components (admin-shell, data-table, etc.)
- **auth/** - Authentication components
- **blog/** - Blog components (post-list, post-content)
- **case-studies/** - Case study components
- **checkout/** - Checkout flow components
- **dashboard/** - Dashboard components (billing, etc.)
- **faq/** - FAQ accordion component
- **layout/** - Layout wrapper components (nav, footer)
- **loyalty/** - Loyalty program components
- **marketing/** - Marketing page renderer and preview system
- **pricing/** - Pricing display components
- **products/** - Product configurator components
- **providers/** - Context providers (QueryProvider)
- **rich-text/** - Rich text rendering core
  - **marketing/** - 10 marketing block components
- **testimonials/** - Testimonial display

---

## 4. HOW COMPONENTS ARE CURRENTLY STRUCTURED

### Pattern 1: Marketing Blocks (Payload → React Components)

**Data Flow**:
```
Payload CMS Editor (/admin)
        ↓ (defines block data)
Content stored in PostgreSQL
        ↓
apps/web fetches via queries.ts
        ↓
Zod validation (types.ts)
        ↓
sections.tsx orchestrator
        ↓
React Components (rich-text/marketing/*.tsx)
        ↓
Styled HTML rendered to user
```

**Example Component** (`rich-text/marketing/hero-callout.tsx`):
- Accepts props matching block schema
- Self-contained styling (Tailwind)
- No external dependencies beyond React & Next.js
- Handles optional fields gracefully

### Pattern 2: Lexical Block Converters

**Location**: `apps/web/src/components/rich-text/marketing-converters.tsx`

Payload's Lexical editor uses converters to map serialized block nodes to React components:

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
- Each schema maps to corresponding React component props

### Pattern 4: Section Rendering

**Location**: `apps/web/src/components/marketing/sections.tsx`

Main orchestrator that:
1. Takes Page content (array of blocks)
2. Discriminates on `_type` field
3. Renders appropriate component for each block type
4. Handles fallbacks and missing data gracefully

---

## 5. EXISTING PAYLOAD BLOCKS & COLLECTIONS

### Payload Block Configuration Hierarchy

```
payload.config.ts
├── lexicalEditor()
│   └── BlocksFeature
│       └── blocks: marketingBlocks (9 blocks)
│           └── Each block: { slug, labels, fields[] }
│
└── collections: [
    ├── Pages
    │   └── content: blocks field
    │       ├── sectionBlock
    │       └── testimonialHighlightBlock
    ├── BlogPosts
    ├── Faqs
    └── ... more collections
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
- `HeroCallout`: eyebrow, headline, body, primaryCta, secondaryCta, align
- `MetricGrid`: heading, subheading, metrics[]
- `ProductCard`: badge, name, price, features[], ctaLabel, ctaHref
- etc.

### Strategy 2: Styling via Tailwind CSS
All components use Tailwind classes:
- Dark theme (text-white, bg-white/5, border-white/10, etc.)
- Responsive design (md:, sm: prefixes)
- Consistent spacing and typography patterns

### Strategy 3: Type Safety
Strong TypeScript typing throughout:
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
Components include `.stories.tsx` files:
- `post-list.stories.tsx`
- `pricing-grid.stories.tsx`
- `accordion.stories.tsx`
- Enables visual testing and documentation

### Strategy 5: Server-Side Validation
`apps/web/src/server/cms/types.ts` validates content:
- Zod runtime validation
- Type inference for React props
- Discriminated unions prevent invalid data

---

## 7. FIELD CUSTOMIZATION SYSTEM

### Custom Fields
**Location**: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/fields/`

**environment.ts** - Multi-environment content field:
- Used in: Pages, BlogPosts, etc.
- Allows content isolation by environment

### Hooks System
**Location**: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/hooks/`

1. **revalidate.ts** - Incremental Static Regeneration (ISR)
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
   - CMS running on: `http://localhost:3050`

2. **Type Generation**
   - Payload auto-generates: `payload-types.ts` (internal CMS types)
   - Web app uses: `server/cms/types.ts` (Zod validation layer)
   - Provides type safety between CMS and frontend

3. **Live Preview System**
   - Payload publishes changes via webhooks
   - Web app subscribes to live preview events
   - Real-time content updates in admin

---

## 9. KEY FILES SUMMARY

| Path | Purpose | Key Content |
|------|---------|-------------|
| `apps-cms-payload/src/payload.config.ts` | Main CMS config | Collections, blocks, routes |
| `apps-cms-payload/src/lexical/marketing.ts` | Block definitions | 9 marketing block schemas |
| `apps-cms-payload/src/collections/Pages.ts` | Page collection | Hero + section blocks |
| `apps-cms-payload/src/collections/BlogPosts.ts` | Blog collection | Blog articles with rich text |
| `apps/web/src/components/rich-text/marketing/` | Block components | 10 React implementations |
| `apps/web/src/components/rich-text/marketing-converters.tsx` | Block converters | Payload → React mapping |
| `apps/web/src/components/marketing/sections.tsx` | Content orchestrator | Page section renderer |
| `apps/web/src/server/cms/types.ts` | Type validation | Zod schemas for all content |
| `apps/web/src/server/cms/queries.ts` | Data fetching | API calls to Payload |

---

## RECOMMENDATIONS FOR NON-INTRUSIVE COMPONENT LIBRARY

### Integration Strategy

#### 1. Create New Block Definition Files (Minimal Edits)

```typescript
// NEW FILE: apps-cms-payload/src/lexical/customBlocks.ts
import { Block } from "payload";

export const customBlocks: Block[] = [
  {
    slug: "custom-component-name",
    labels: { singular: "Custom Component", plural: "Custom Components" },
    fields: [
      // field definitions matching your new component props
    ]
  }
];
```

#### 2. Register Blocks in Payload Config (Single Edit)

```typescript
// FILE: apps-cms-payload/src/payload.config.ts
// CHANGE: Import and add to BlocksFeature

import { marketingBlocks } from "./lexical/marketing";
import { customBlocks } from "./lexical/customBlocks";  // NEW IMPORT

editor: lexicalEditor({
  features: ({ defaultFeatures }) => [
    ...defaultFeatures,
    BlocksFeature({
      blocks: [...marketingBlocks, ...customBlocks]  // ADD customBlocks
    })
  ]
})
```

#### 3. Create React Component Implementations

```typescript
// NEW FILE: apps/web/src/components/rich-text/marketing/custom-component.tsx
type CustomComponentProps = {
  // props matching your block schema
};

export function CustomComponent(props: CustomComponentProps) {
  // component implementation with Tailwind styling
}
```

#### 4. Create Lexical Converters (Single New File)

```typescript
// NEW FILE: apps/web/src/components/rich-text/custom-converters.tsx
import { JSXConverters } from "@payloadcms/richtext-lexical/react";
import { CustomComponent } from "./marketing/custom-component";

export const customLexicalConverters: JSXConverters = {
  blocks: {
    "custom-component-name": ({ node }) => (
      <CustomComponent {...mapNodeFields(node)} />
    )
  }
};
```

#### 5. Update Main Renderer (Minimal Edit)

```typescript
// FILE: apps/web/src/components/rich-text/rich-text.tsx
// ADD: customLexicalConverters to converter merge

import { customLexicalConverters } from "./custom-converters";

const withMarketingConverters = (
  converters?: JSXConverters | JSXConvertersFunction
): JSXConvertersFunction => {
  return ({ defaultConverters }) => {
    const baseWithMarketing = mergeConverters(
      defaultConverters, 
      marketingLexicalConverters,
      customLexicalConverters  // ADD THIS
    );
    // ... rest of function
  };
};
```

#### 6. Add Type Validation (Single New File)

```typescript
// NEW FILE: apps/web/src/server/cms/custom-types.ts
import { z } from "zod";

export const customComponentSchema = z.object({
  kind: z.literal("custom-component"),
  // field schemas matching your component props
});

// Export for validation in sections.tsx
```

#### 7. Update Section Renderer (Minimal Edit)

```typescript
// FILE: apps/web/src/components/marketing/sections.tsx
// ADD: import and handle custom block types

import { customComponentSchema } from "@/server/cms/custom-types";

// In the discriminatedUnion, add your custom schema:
const marketingContentSchema = z.discriminatedUnion("kind", [
  // existing schemas...
  customComponentSchema  // ADD THIS
]);
```

---

## Benefits of This Approach

1. **Non-Intrusive**: Only 2-3 minimal edits to existing files
2. **Scalable**: Add unlimited new block types without modifying core logic
3. **Type-Safe**: Full TypeScript support throughout
4. **Reusable**: Components work both in Payload editor and React apps
5. **Testable**: Each component can be tested independently
6. **Documented**: Storybook integration ready for UI components
7. **Future-Proof**: Uses Payload's standard block system

---

## Current Component Locations for Reference

### Marketing Block Components
- `/Users/magnusohle/cursorprojects/smplat/apps/web/src/components/rich-text/marketing/hero-callout.tsx`
- `/Users/magnusohle/cursorprojects/smplat/apps/web/src/components/rich-text/marketing/metric-grid.tsx`
- `/Users/magnusohle/cursorprojects/smplat/apps/web/src/components/rich-text/marketing/product-card.tsx`
- `/Users/magnusohle/cursorprojects/smplat/apps/web/src/components/rich-text/marketing/testimonial-callout.tsx`
- Plus 6 more component implementations

### Integration Points
- Payload block definitions: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/lexical/marketing.ts`
- CMS config: `/Users/magnusohle/cursorprojects/smplat/apps-cms-payload/src/payload.config.ts`
- Converters: `/Users/magnusohle/cursorprojects/smplat/apps/web/src/components/rich-text/marketing-converters.tsx`
- Type schemas: `/Users/magnusohle/cursorprojects/smplat/apps/web/src/server/cms/types.ts`

