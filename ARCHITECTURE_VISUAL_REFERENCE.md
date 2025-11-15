# Visual Architecture Reference Guide

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        SMPLAT MONOREPO                          │
└─────────────────────────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
        ┌───────────▼────────────┐  ┌────────▼───────────┐
        │   apps-cms-payload     │  │      apps/web      │
        │   (Port: 3050)         │  │   (Port: 3000)     │
        │                        │  │                    │
        │  Payload CMS + Next.js │  │  Next.js Frontend  │
        └────────────────────────┘  └────────────────────┘
                    │                         │
                    │ REST/GraphQL API        │
                    └──────────┬──────────────┘
                               │
                      ┌────────▼────────┐
                      │  PostgreSQL DB  │
                      └─────────────────┘
```

---

## Data Flow: Content to Rendering

```
┌──────────────────────────────────────────────────────────────────────┐
│ 1. CONTENT CREATION                                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Content Editor                                                      │
       │                                                               │
       ├─→ Opens: http://localhost:3050/admin                         │
       │                                                               │
       ├─→ Creates/Edits Page                                         │
       │                                                               │
       ├─→ Selects Block from Lexical Editor:                         │
       │   □ marketing-hero                                           │
       │   □ marketing-metrics                                        │
       │   □ marketing-product-card  ← Choose one                     │
       │   □ ... (9 blocks available)                                 │
       │                                                               │
       └─→ Fills Fields & Publishes                                   │
           { name: "...", price: 99, features: [...] }               │
                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 2. STORAGE                                                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  PostgreSQL Database                                                │
│  ┌─ pages table ─────────────────────────────────────────┐         │
│  │ id: 123                                               │         │
│  │ title: "Pricing Page"                                 │         │
│  │ slug: "pricing"                                       │         │
│  │ content: [                                            │         │
│  │   {                                                   │         │
│  │     blockType: "marketing-product-card",              │         │
│  │     name: "Starter Plan",                             │         │
│  │     price: 99,                                        │         │
│  │     features: [...]                                   │         │
│  │   }                                                   │         │
│  │ ]                                                     │         │
│  └───────────────────────────────────────────────────────┘         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 3. RETRIEVAL                                                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  apps/web/src/server/cms/queries.ts                                │
│  ┌──────────────────────────────────────────────────────┐          │
│  │ fetch('http://localhost:3050/api/pages/pricing')    │          │
│  │   ↓                                                  │          │
│  │ Returns: { id, title, content: [...blocks...] }     │          │
│  └──────────────────────────────────────────────────────┘          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 4. VALIDATION                                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  apps/web/src/server/cms/types.ts (Zod Schemas)                   │
│  ┌──────────────────────────────────────────────────────┐          │
│  │ const productCardSchema = z.object({                │          │
│  │   kind: z.literal("marketing-product-card"),        │          │
│  │   name: z.string().optional(),                      │          │
│  │   price: z.number().optional(),                     │          │
│  │   features: z.array(z.object({...}))                │          │
│  │ })                                                   │          │
│  │                                                      │          │
│  │ pageSchema.parse(data)  ← Validates & throws       │          │
│  └──────────────────────────────────────────────────────┘          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 5. CONVERSION (Payload Lexical → React)                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  apps/web/src/components/rich-text/marketing-converters.tsx        │
│  ┌──────────────────────────────────────────────────────┐          │
│  │ export const marketingLexicalConverters = {          │          │
│  │   blocks: {                                          │          │
│  │     "marketing-product-card": ({ node }) => (        │          │
│  │       <ProductCard                                   │          │
│  │         name={node.fields.name}                      │          │
│  │         price={node.fields.price}                    │          │
│  │         features={node.fields.features}              │          │
│  │       />                                             │          │
│  │     )                                                │          │
│  │   }                                                  │          │
│  │ }                                                    │          │
│  └──────────────────────────────────────────────────────┘          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 6. RENDERING                                                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  apps/web/src/components/rich-text/marketing/product-card.tsx      │
│  ┌──────────────────────────────────────────────────────┐          │
│  │ export function ProductCard({                        │          │
│  │   name, price, features                              │          │
│  │ }: ProductCardProps) {                               │          │
│  │   return (                                           │          │
│  │     <section className="rounded-3xl border...">     │          │
│  │       {name && (                                     │          │
│  │         <h3 className="text-2xl text-white">        │          │
│  │           {name}                                     │          │
│  │         </h3>                                        │          │
│  │       )}                                             │          │
│  │       {price && (                                    │          │
│  │         <p className="text-3xl font-bold...">       │          │
│  │           ${price}                                   │          │
│  │         </p>                                         │          │
│  │       )}                                             │          │
│  │       {/* features list */}                          │          │
│  │     </section>                                       │          │
│  │   )                                                  │          │
│  │ }                                                    │          │
│  └──────────────────────────────────────────────────────┘          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ 7. DISPLAY                                                           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Browser (localhost:3000)                                           │
│  ┌──────────────────────────────────────────────────────┐          │
│  │                                                      │          │
│  │  ┌─ Pricing Page ────────────────────────────────┐  │          │
│  │  │                                               │  │          │
│  │  │  Starter Plan                                 │  │          │
│  │  │  $99/month                                    │  │          │
│  │  │  ✓ Feature 1                                  │  │          │
│  │  │  ✓ Feature 2                                  │  │          │
│  │  │                                               │  │          │
│  │  └───────────────────────────────────────────────┘  │          │
│  │                                                      │          │
│  └──────────────────────────────────────────────────────┘          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Block Registration Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ apps-cms-payload/src/lexical/marketing.ts                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ const heroCalloutBlock: Block = {                                  │
│   slug: "marketing-hero",           ← Block identifier            │
│   labels: {                                                        │
│     singular: "Hero callout",                                      │
│     plural: "Hero callouts"                                        │
│   },                                                               │
│   fields: [                         ← Content editor fields       │
│     { name: "eyebrow", type: "text" },                            │
│     { name: "headline", type: "textarea" },                       │
│     { name: "primaryCtaLabel", type: "text" },                    │
│     ...                                                            │
│   ]                                                                │
│ }                                                                  │
│                                                                     │
│ export const marketingBlocks = [                                  │
│   heroCalloutBlock,                                                │
│   metricGridBlock,                                                 │
│   ... 7 more blocks                                                │
│ ]                                                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ apps-cms-payload/src/payload.config.ts                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ import { marketingBlocks } from "./lexical/marketing"             │
│                                                                     │
│ buildConfig({                                                      │
│   editor: lexicalEditor({                                          │
│     features: ({ defaultFeatures }) => [                           │
│       ...defaultFeatures,                                          │
│       BlocksFeature({                                              │
│         blocks: marketingBlocks  ← Registered here                │
│       })                                                            │
│     ]                                                               │
│   }),                                                               │
│   collections: [                                                   │
│     Pages,  ← Uses blocks in content field                        │
│     ...                                                             │
│   ]                                                                 │
│ })                                                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Payload CMS Admin Panel                                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ When editing page content, Lexical editor shows:                  │
│                                                                     │
│ ┌─ Block Menu ───────────────────────┐                            │
│ │ + Hero callout                     │ ← Available block          │
│ │ + Metric grid                      │                            │
│ │ + Testimonial callout              │                            │
│ │ + Product card                     │                            │
│ │ ... (9 total)                      │                            │
│ └────────────────────────────────────┘                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Mapping

```
PAYLOAD BLOCK                    REACT COMPONENT
═════════════════════════════════════════════════════════════════════

marketing-hero                  →  HeroCallout
  - slug: "marketing-hero"         /apps/web/src/components/
  - fields:                        rich-text/marketing/
    - eyebrow                      hero-callout.tsx
    - headline                     
    - body                         Props match exactly:
    - primaryCta                   {eyebrow, headline, body,
    - secondaryCta                 primaryCta, secondaryCta}

marketing-metrics               →  MetricGrid
  - slug: "marketing-metrics"      /apps/web/src/components/
  - fields:                        rich-text/marketing/
    - heading                      metric-grid.tsx
    - subheading                   
    - metrics[]                    Props match exactly:
      - label                      {heading, subheading,
      - value                      metrics[{label,value,
      - description                description}]}

marketing-testimonial           →  TestimonialCallout
  - slug: "marketing-..."          /apps/web/src/components/
  - fields:                        rich-text/marketing/
    - quote                        testimonial-callout.tsx
    - author                       
    - role                         Props match exactly:
    - company                      {quote, author, role,
                                   company}

... (6 more similar mappings)

```

---

## Type Safety Pipeline

```
┌──────────────────────────────────────────────────────────────────┐
│ Raw JSON from Payload API                                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ {                                                               │
│   "id": "123",                                                  │
│   "title": "Pricing",                                           │
│   "content": [                                                  │
│     {                                                           │
│       "blockType": "marketing-metrics",  ← String literal       │
│       "heading": "Our Stats",                                   │
│       "metrics": [                                              │
│         { "label": "Customers", "value": "1000+" }             │
│       ]                                                         │
│     }                                                           │
│   ]                                                             │
│ }                                                               │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                                  │
                   ↓ Validation with Zod ↓
┌──────────────────────────────────────────────────────────────────┐
│ apps/web/src/server/cms/types.ts                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ const marketingMetricsSchema = z.object({                      │
│   kind: z.literal("metrics"),      ← Narrows type              │
│   heading: z.string().optional(),                              │
│   subheading: z.string().optional(),                           │
│   metrics: z.array(                                            │
│     z.object({                                                  │
│       label: z.string(),           ← Enforces shape           │
│       value: z.string(),                                        │
│       description: z.string().optional()                       │
│     })                                                          │
│   )                                                             │
│ })                                                              │
│                                                                  │
│ // Type inference:                                              │
│ type MetricsContent = z.infer<typeof marketingMetricsSchema>  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                                  │
                 ↓ Typed object (TypeScript) ↓
┌──────────────────────────────────────────────────────────────────┐
│ React Component Props (Type-Safe)                               │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ <MetricGrid                                                    │
│   heading={content.heading}           ← TypeScript knows      │
│   subheading={content.subheading}       this is string        │
│   metrics={content.metrics}             and this is             │
│ />                                      Metric[]              │
│                                                                  │
│ function MetricGrid(props: MetricsContent) {                  │
│   // TypeScript autocomplete works!                           │
│   // IDE knows props.heading is string | undefined            │
│   // IDE knows props.metrics[i].label is string               │
│ }                                                              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Directory Tree: Critical Paths

```
smplat/
├── apps-cms-payload/
│   ├── src/
│   │   ├── payload.config.ts          ← ★ MAIN CONFIG
│   │   ├── lexical/
│   │   │   └── marketing.ts           ← ★ BLOCK DEFINITIONS (9 blocks)
│   │   ├── collections/
│   │   │   ├── Pages.ts               ← ★ PAGE SCHEMA (uses blocks)
│   │   │   ├── BlogPosts.ts
│   │   │   └── ... (7 more)
│   │   ├── hooks/
│   │   │   ├── revalidate.ts          ← ISR on content change
│   │   │   └── livePreview.ts         ← Real-time preview
│   │   └── fields/
│   │       └── environment.ts         ← Multi-environment field
│   └── package.json                  ← Payload CMS v3.61.1
│
├── apps/web/
│   ├── src/
│   │   ├── components/
│   │   │   ├── rich-text/
│   │   │   │   ├── rich-text.tsx      ← Renderer entry point
│   │   │   │   ├── marketing-converters.tsx ← ★ BLOCK→REACT MAPPING
│   │   │   │   └── marketing/         ← ★ COMPONENTS (10 files)
│   │   │   │       ├── hero-callout.tsx
│   │   │   │       ├── metric-grid.tsx
│   │   │   │       ├── product-card.tsx
│   │   │   │       ├── testimonial-callout.tsx
│   │   │   │       ├── timeline.tsx
│   │   │   │       ├── feature-grid.tsx
│   │   │   │       ├── media-gallery.tsx
│   │   │   │       ├── cta-cluster.tsx
│   │   │   │       ├── comparison-table.tsx
│   │   │   │       └── README.md
│   │   │   └── marketing/
│   │   │       └── sections.tsx       ← ★ ORCHESTRATOR
│   │   └── server/cms/
│   │       ├── types.ts               ← ★ ZOD SCHEMAS & VALIDATION
│   │       ├── queries.ts             ← Data fetching
│   │       └── ... (more utilities)
│   └── package.json                  ← Next.js 14.1.0
│
└── Documentation/
    ├── CMS_COMPONENT_ARCHITECTURE.md (← You are here)
    ├── COMPONENT_LIBRARY_QUICKSTART.md
    └── EXPLORATION_SUMMARY.txt

★ = Critical for component library integration
```

---

## Integration Points for New Components

```
To add your custom component, follow this pattern:

┌────────────────────────────────────────────────────────────────┐
│ YOUR NEW COMPONENT INTEGRATION                                 │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ 1. CREATE BLOCK DEFINITION                                    │
│    File: apps-cms-payload/src/lexical/customBlocks.ts (NEW)  │
│    ─────────────────────────────────────────────────────────  │
│    const myNewBlock: Block = {                                │
│      slug: "my-custom-block",                                │
│      fields: [...]  ← fields editors will fill               │
│    }                                                          │
│                                                                │
│ 2. REGISTER BLOCK                                             │
│    File: apps-cms-payload/src/payload.config.ts (EDIT)       │
│    ─────────────────────────────────────────────────────────  │
│    import { customBlocks } from "./lexical/customBlocks"     │
│    // In buildConfig:                                         │
│    BlocksFeature({                                            │
│      blocks: [...marketingBlocks, ...customBlocks]           │
│    })                                                         │
│                                                                │
│ 3. CREATE REACT COMPONENT                                     │
│    File: apps/web/src/components/rich-text/                  │
│           marketing/my-custom.tsx (NEW)                       │
│    ─────────────────────────────────────────────────────────  │
│    export function MyCustom(props: MyCustomProps) {           │
│      return <section>...</section>                            │
│    }                                                          │
│                                                                │
│ 4. CREATE CONVERTER                                           │
│    File: apps/web/src/components/rich-text/                  │
│           custom-converters.tsx (NEW)                         │
│    ─────────────────────────────────────────────────────────  │
│    export const customLexicalConverters = {                  │
│      blocks: {                                                │
│        "my-custom-block": ({ node }) => (                    │
│          <MyCustom {...mapFields(node)} />                   │
│        )                                                      │
│      }                                                        │
│    }                                                          │
│                                                                │
│ 5. ADD TYPE VALIDATION                                        │
│    File: apps/web/src/server/cms/custom-types.ts (NEW)      │
│    ─────────────────────────────────────────────────────────  │
│    export const myCustomSchema = z.object({                  │
│      kind: z.literal("my-custom-block"),                    │
│      // ... field validation                                 │
│    })                                                        │
│                                                                │
│ TOTAL: 4 NEW FILES + 1 MINIMAL EDIT = NON-INTRUSIVE          │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Component Dependencies

```
MINIMAL DEPENDENCIES:

✓ React          - Core UI library
✓ Next.js Link   - For navigation links (optional)
✓ Tailwind CSS   - Styling only
✓ TypeScript     - Type safety

WHAT NOT TO USE:

✗ External CSS libraries (Bootstrap, etc.)
✗ CSS modules (use Tailwind)
✗ Design system packages (not needed)
✗ State management (components are pure)
✗ API calls (handled by parent)

DEPENDENCIES AVAILABLE (but optional):

→ Lucide React   - Icons (already in project)
→ Zod            - Validation (already in project)
→ Zustand        - State (already in project)
→ TanStack Query  - Data fetching (already in project)
```

---

## File Naming Conventions

```
Block Definition:
  location: apps-cms-payload/src/lexical/
  naming:   {descriptive}-blocks.ts or marketing.ts
  export:   export const customBlocks: Block[]

React Component:
  location: apps/web/src/components/rich-text/marketing/
  naming:   {kebab-case-component-name}.tsx
  export:   export function ComponentName(props) { ... }

Converter:
  location: apps/web/src/components/rich-text/
  naming:   {scope}-converters.tsx (e.g., custom-converters.tsx)
  export:   export const {scope}LexicalConverters: JSXConverters

Type Schema:
  location: apps/web/src/server/cms/
  naming:   {scope}-types.ts (e.g., custom-types.ts)
  export:   export const {scope}Schema = z.object(...)

Type File:
  naming:   {ComponentName}Props (for component props)
            {ComponentName}Document (for data from CMS)
  export:   export type { ... }
```

---

## Quick Debug Checklist

```
Block not appearing in editor?
  ☐ Check payload.config.ts BlocksFeature includes your block
  ☐ Verify block slug is unique (not duplicate)
  ☐ Restart CMS (npm run dev)
  ☐ Clear browser cache and refresh

Component not rendering?
  ☐ Check converter slug matches block slug exactly
  ☐ Verify component is exported
  ☐ Check converter is added to mergeConverters
  ☐ Ensure Zod schema is defined for your block

Type errors in component?
  ☐ Check Zod schema matches component props
  ☐ Verify optional fields are marked with .optional()
  ☐ Run: npm run typecheck

Content not showing up?
  ☐ Check data is published in Payload admin
  ☐ Verify environment field matches (if used)
  ☐ Check API response in browser DevTools Network tab
  ☐ Validate data against Zod schema in types.ts
```

