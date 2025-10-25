# Design System & UX Foundations

## Brand Attributes
- **Visual Language**: Minimalist, high-contrast palette blending deep charcoal (#0F1115), accent blue (#2E6FED), and neutral sand (#F6F3ED).
- **Tone**: Confident, data-driven, trustworthy—reflecting enterprise-grade social media operations.
- **Imagery**: Abstract gradients, subtle grain textures, data visualizations, real client success snapshots (opt-in).

## Component Library
- **Framework**: Next.js + Tailwind CSS with shadcn/ui primitives for accessible, composable components.
- **Core Components**:
  - Navigation: top nav with mega-menu variants, sticky CTA, responsive drawer.
  - Hero sections, feature grids, testimonial carousels, pricing tables.
  - Form controls with validation states, inline error messaging, MFA inputs.
  - Dashboard widgets: metric cards, trend charts (Recharts or Tremor), activity timelines.
  - Data tables with server-side pagination/sorting, bulk actions.
  - Modals, drawers, toasts, inline alerts (Radix primitives).
- **Design Tokens**:
  - Colors: `primary`, `secondary`, `accent`, `success`, `warning`, `danger`, neutrals scale.
  - Typography: Sans-serif (Inter) for body, Display (Satoshi or similar) for headings.
  - Spacing scale (4px grid), border radii (4, 8, 16), elevation tokens.
  - Motion: 200ms ease-out for transitions; use reduced motion preferences.

## Accessibility
- WCAG 2.1 AA contrast minimums.
- Keyboard navigation patterns documented; focus ring styling consistent.
- Use ARIA roles for tab structures, modals, data visualizations.
- Provide alternative text for imagery and chart descriptions.

## Theming & Internationalization
- Dark/light mode toggles with CSS variables.
- Localization-ready content via `next-intl` or built-in Next.js i18n routing.
- Support German/English copy; date/time formatting via `Intl`.

## Design Workflow
- Figma library mirroring component taxonomy; sync updates to documentation site.
- Design review cadence: weekly design-engineering sync, asynchronous feedback with annotation tools.
- Snapshot testing with Chromatic (Storybook) for UI regressions.

## Implementation Tasks
1. Establish Tailwind config with design tokens; integrate shadcn/ui generator.
2. Set up Storybook in `apps/web` with MDX docs and accessibility addon.
3. Build foundational components (buttons, inputs, layout primitives) and document usage.
4. Implement responsive grid system and spacing utilities.
5. Create dashboard metric card component with skeleton loaders and error states.
6. Define Figma-to-code handoff guidelines (naming conventions, versioning).

