# Component Library Integration - Quick Start Guide

## What You Need to Know (TL;DR)

Your project has a **Payload CMS → React Component** pipeline:

1. **Payload CMS** (port 3050) stores content with custom blocks
2. **Lexical Editor** allows editors to compose pages using reusable blocks
3. **React Components** render the blocks on your Next.js frontend
4. **Zod Validation** ensures type safety between CMS and frontend

---

## Quick File Reference

### CMS Side (apps-cms-payload/)
```
src/
├── payload.config.ts          ← MAIN CONFIG: registers all blocks
├── lexical/
│   └── marketing.ts            ← BLOCK DEFINITIONS: 9 marketing blocks
└── collections/
    ├── Pages.ts                ← PAGE COLLECTION: uses blocks
    ├── BlogPosts.ts
    └── (7 more collections)
```

### Frontend Side (apps/web/)
```
src/
├── components/
│   └── rich-text/
│       ├── marketing-converters.tsx  ← CONVERTERS: Payload → React
│       └── marketing/                 ← COMPONENTS: the UI
│           ├── hero-callout.tsx       (and 9 others)
│           └── ...
├── components/marketing/
│   └── sections.tsx            ← ORCHESTRATOR: renders all blocks
└── server/cms/
    └── types.ts                ← VALIDATION: Zod schemas
```

---

## Adding a New Component Type (5 Steps)

### Step 1: Define Block Schema (NEW FILE)
```typescript
// apps-cms-payload/src/lexical/customBlocks.ts
import { Block } from "payload";

export const customBlocks: Block[] = [
  {
    slug: "my-custom-block",
    labels: { singular: "My Custom Block", plural: "My Custom Blocks" },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "description", type: "textarea" },
      { name: "items", type: "array", fields: [
        { name: "label", type: "text" }
      ]}
    ]
  }
];
```

### Step 2: Register in Payload Config (EDIT)
```typescript
// apps-cms-payload/src/payload.config.ts
import { customBlocks } from "./lexical/customBlocks";

// In buildConfig:
BlocksFeature({
  blocks: [...marketingBlocks, ...customBlocks]  // ← Add this
})
```

### Step 3: Create React Component (NEW FILE)
```typescript
// apps/web/src/components/rich-text/marketing/my-custom-block.tsx
type MyCustomBlockProps = {
  title?: string;
  description?: string;
  items?: Array<{ label: string }>;
};

export function MyCustomBlock({ title, description, items }: MyCustomBlockProps) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-10">
      {title && <h2 className="text-white text-2xl font-semibold">{title}</h2>}
      {description && <p className="text-white/70 mt-4">{description}</p>}
      {items?.length && (
        <ul className="mt-6 space-y-2">
          {items.map((item, i) => (
            <li key={i} className="text-white/60">{item.label}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

### Step 4: Create Converter (NEW FILE)
```typescript
// apps/web/src/components/rich-text/custom-converters.tsx
import { JSXConverters } from "@payloadcms/richtext-lexical/react";
import { MyCustomBlock } from "./marketing/my-custom-block";

export const customLexicalConverters: JSXConverters = {
  blocks: {
    "my-custom-block": ({ node }) => (
      <MyCustomBlock
        title={node.fields.title}
        description={node.fields.description}
        items={node.fields.items}
      />
    )
  }
};
```

### Step 5: Add Validation Schema (NEW FILE)
```typescript
// apps/web/src/server/cms/custom-types.ts
import { z } from "zod";

export const customItemSchema = z.object({
  label: z.string()
});

export const myCustomBlockSchema = z.object({
  kind: z.literal("my-custom-block"),
  title: z.string().optional(),
  description: z.string().optional(),
  items: z.array(customItemSchema).optional()
});
```

---

## Component Patterns to Follow

### Styling
- Use Tailwind CSS only
- Dark theme: `text-white`, `bg-white/5`, `border-white/10`
- Responsive: include `md:` and `sm:` prefixes
- Spacing: use consistent `gap-4`, `p-6`, `mt-4` patterns

### Props
- Keep them optional with `?:`
- Use descriptive types
- Export types for reusability
- Handle missing data gracefully

### Structure
```typescript
// 1. Import dependencies
import Link from "next/link";

// 2. Define types
type MyComponentProps = {
  title?: string;
  items?: Array<{ label: string }>;
};

// 3. Export component
export function MyComponent({ title, items }: MyComponentProps) {
  // 4. Handle edge cases
  if (!items?.length) return null;
  
  // 5. Render with Tailwind
  return (
    <section className="...">
      {/* content */}
    </section>
  );
}
```

---

## Existing Block Types (Reference)

| Slug | Component | Props |
|------|-----------|-------|
| `marketing-hero` | HeroCallout | eyebrow, headline, body, primaryCta, secondaryCta |
| `marketing-metrics` | MetricGrid | heading, subheading, metrics[] |
| `marketing-testimonial` | TestimonialCallout | quote, author, role, company |
| `marketing-product-card` | ProductCard | badge, name, price, features[], ctaLabel |
| `marketing-timeline` | TimelineShowcase | heading, items[] |
| `marketing-feature-grid` | FeatureGrid | heading, features[], columns |
| `marketing-media-gallery` | MediaGallery | heading, media[] |
| `marketing-cta-cluster` | CtaCluster | heading, ctas[] |
| `marketing-comparison-table` | ComparisonTable | heading, columns[], rows[] |

View implementations: `/apps/web/src/components/rich-text/marketing/`

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Payload CMS Admin Panel (localhost:3050)                    │
│ Content editor selects blocks and fills in fields            │
└──────────────┬──────────────────────────────────────────────┘
               │
               ↓ (PostgreSQL database)
┌─────────────────────────────────────────────────────────────┐
│ apps/web/src/server/cms/queries.ts                          │
│ Fetches content from Payload API                            │
└──────────────┬──────────────────────────────────────────────┘
               │
               ↓ (Raw JSON)
┌─────────────────────────────────────────────────────────────┐
│ apps/web/src/server/cms/types.ts (Zod validation)          │
│ Validates structure matches expected schema                 │
└──────────────┬──────────────────────────────────────────────┘
               │
               ↓ (Validated TypeScript object)
┌─────────────────────────────────────────────────────────────┐
│ apps/web/src/components/marketing/sections.tsx             │
│ Orchestrates rendering based on block type                 │
└──────────────┬──────────────────────────────────────────────┘
               │
               ├→ rich-text/marketing-converters.tsx (Payload format)
               │  or
               ├→ custom-converters.tsx (Your custom converters)
               │
               ↓
┌─────────────────────────────────────────────────────────────┐
│ React Components: rich-text/marketing/*.tsx                │
│ Render styled HTML with Tailwind                           │
└──────────────┬──────────────────────────────────────────────┘
               │
               ↓
    Browser displays page (localhost:3000)
```

---

## File Locations Summary

| Task | Location |
|------|----------|
| Define new block | `apps-cms-payload/src/lexical/customBlocks.ts` |
| Register blocks | `apps-cms-payload/src/payload.config.ts` |
| Create component | `apps/web/src/components/rich-text/marketing/my-component.tsx` |
| Create converter | `apps/web/src/components/rich-text/custom-converters.tsx` |
| Add types | `apps/web/src/server/cms/custom-types.ts` |
| View existing | `apps/web/src/components/rich-text/marketing/*.tsx` |
| View block defs | `apps-cms-payload/src/lexical/marketing.ts` |

---

## Testing Your Component

### 1. Add to Payload (CMS)
- Start CMS: `cd apps-cms-payload && npm run dev`
- Create/edit a page at `http://localhost:3050/admin`
- Select your block from the Lexical editor
- Fill in the fields

### 2. Render in Next.js
- Start web: `cd apps/web && npm run dev`
- View at `http://localhost:3000`
- Content from CMS automatically appears

### 3. Storybook (Optional)
- Create `.stories.tsx` file in same directory as component
- Run: `cd apps/web && npm run storybook`
- View at `http://localhost:6006`

---

## Common Mistakes to Avoid

1. **Forgetting to register in payload.config.ts** → Block won't appear in editor
2. **Using external CSS** → Use Tailwind only
3. **Not handling undefined props** → Component will crash
4. **Mismatched block slug and converter slug** → Converter won't activate
5. **Not exporting component** → Can't import in converter
6. **Breaking existing imports** → Keep file structure consistent

---

## Where to Get Help

- See implementation: `/apps/web/src/components/rich-text/marketing/hero-callout.tsx`
- See block definition: `/apps-cms-payload/src/lexical/marketing.ts`
- See converter: `/apps/web/src/components/rich-text/marketing-converters.tsx`
- See validation: `/apps/web/src/server/cms/types.ts`
- Full architecture: `CMS_COMPONENT_ARCHITECTURE.md`

