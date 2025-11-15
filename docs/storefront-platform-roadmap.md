# Storefront & Platform Experience Roadmap

## Purpose
Capture the end-to-end vision for a production-ready “shop → buy → operate” flow that pairs the merchandising system with a delightful storefront, platform-aware ordering, and trustworthy lifecycle touchpoints. This roadmap complements `docs/product-merchandising-enhancement-plan.md` by detailing the UX, customer-facing commerce, and reporting layers that still need to be built.

## Guiding Principles

1. **Shop-first, platform-aware** – Every surface (home, PLP, PDP, checkout, account) should reinforce “Buy for *your* channel” with saved platform contexts, suggested configs, and direct deep links from account dashboards.
2. **Trust through transparency** – Surface delivery metrics, journey telemetry, and reward progress where customers make decisions (product cards, checkout, account insights).
3. **Persisted commerce data** – Customers can manage billing profiles, addresses, invoices, and order history; admins see the same details plus provider telemetry, refills, and alerts.
4. **Gamification with a purpose** – Rewards, badges, and nudges show measurable progress (“track how your account performs over time”) and tie directly into checkout intents.
5. **Operational parity** – Provider routing, refill triggers, and metrics span admin dashboards, automation runbooks, and customer views.

## Experience Pillars

| Pillar | Scope |
| --- | --- |
| **Immersive Storefront** | Homepage hero + PLP + PDP with trust metrics, upsells, testimonials, gamified CTAs, and cross-sell modules. |
| **Platform-centric Ordering** | Save Instagram/TikTok accounts, pre-fill product configurations, launch purchase flows from account dashboards, and map products to eligible platforms. |
| **Rewards & Gamification** | Integrate loyalty tiers, point tracking, checkout intents, referral boosters, post-checkout projections, and progress widgets across storefront + account. |
| **Commerce Foundations** | Persistent address/contact book, invoice generation/downloads, tax profiles, and payment metadata surfaced for both customers and admins. |
| **Insights & Reporting** | Customer-facing “Performance” dashboard plus admin aggregate/order-level metrics (delivery timelines, provider success, journey telemetry). |
| **Dynamic Pricing Experiments** | Operate catalog-level price tests, manage variant guardrails, and feed telemetry back into storefront merchandising and loyalty nudges. |

## Roadmap Phases

### Phase 1 – Storefront Foundation
1. **Homepage revamp**: hero, product highlights, testimonials, trust badges tied to real metrics.
2. **Product listing (PLP)**: filterable cards with pricing tiers, channel eligibility chips, reward hints.
3. **Product detail (PDP)**: enhanced component sections (journey bindings, fulfillment insights, upsells, “what you’ll track”), plus interactive configurator in-page.
4. **Cart UX**: persistent mini-cart, saved configurations, and inline upsell prompts.
5. **Checkout polish**: progressive disclosure forms, summarized trust metrics, callouts for loyalty/rewards, error handling improvements.

### Phase 2 – Platform-Aware Ordering
1. **Account platform profiles**: allow users to connect/manage Instagram/TikTok/etc. handles with metadata (followers, goals).
2. **Quick order from account dashboard**: CTA per platform to open a modal-based configurator that seeds the cart and jumps to checkout.
3. **Product-platform eligibility map**: admin toggle to mark products for specific platforms; storefront respects these filters automatically.
4. **Journey component context**: propagate platform metadata into journey runtime requests to seed bindings for scripts.

### Phase 3 – Commerce & Billing Essentials
1. **Customer profile persistence**: address book, billing contacts, tax IDs, saved company info.
2. **Invoice pipeline**: generate PDF/HTML invoices on order creation, store references, expose downloads in admin + customer order history.
3. **Order history UI**: storefront account page showing status, delivery metrics, journey results, refill actions when applicable.
4. **Admin parity**: `/admin/orders` surfaces the same profile data, invoice links, and provider telemetry per line item.

### Phase 4 – Loyalty, Rewards & Gamification
1. **Unified rewards banner**: highlight progress toward next reward, recommended redemptions, and referral status on PDP + checkout.
2. **Gamified widgets**: badges for successful deliveries, “streaks” for on-time runs, referral countdowns.
3. **Loyalty reporting**: customer dashboard module summarizing points earned, redemptions, referrals converted, intent follow-ups.
4. **Checkout intents UX**: inline components showing pending intents, ability to cancel/swap rewards before payment, plus success/account banners that reiterate projected points.

### Phase 5 – Insights & Operational Metrics
1. **Customer performance dashboard**: charts for spend, delivery timelines, journey outcomes, provider SLAs.
2. **Admin aggregate dashboards**: success/failure funnels per product, platform, provider, and journey component.
3. **Provider refill workflow**: expose refill triggers + history in admin + customer order details, with notifications when refills complete.
4. **Telemetry bridge**: unify journey runtime telemetry, provider metrics, and loyalty events into a warehouse-ready feed for reporting.

### Phase 6 – Dynamic Pricing & Merchandising Intelligence
1. **Pricing experiment orchestration**: build admin UI + automation for `/api/v1/catalog/pricing-experiments` so merchandisers can define variants, guardrails, and assignment strategies.
2. **Storefront awareness**: surface experiment variants on PDP/checkout to explain live pricing context (control vs. discount copy) and tie into loyalty messaging.
3. **Telemetry feedback loops**: route pricing experiment metrics into loyalty + journey context to backstop incentives (“this tier unlocked the spring-offer variant”).
4. **Guardrail automation**: block or pause variants when telemetry indicates churn risk (low conversions, high refunds) and notify operators automatically.

## Pricing Experiment Admin Flow

Operators can now manage pricing experiments directly from the `Merchandising → Pricing experiments` surface inside the admin control hub (`/admin/merchandising/pricing-experiments`). The view ships with:

1. **Catalog overview** – KPI cards for running/paused/completed experiments plus a sortable table showing target product, variant count, and latest telemetry window.
2. **Experiment detail cards** – each experiment renders variant tables, sparkline telemetry charts (exposures, conversions, revenue), and inline forms to tweak status, targeting metadata, or feature flag keys.
3. **Event logger** – admins can backfill telemetry by logging exposures/conversions/revenue per variant, which immediately updates the charts.
4. **Creation workflow** – the create form supports multiple variants (control + challengers) with weight, adjustment kind (delta or multiplier), and price inputs. Slug, target product slug, segments, and assignment strategy all map 1:1 to `/api/v1/catalog/pricing-experiments`.

### Quickstart

1. Open `/admin/merchandising/pricing-experiments`.
2. Fill out the “Create pricing experiment” form with slug, product slug, and at least two variants (toggle the control variant checkbox for the baseline).
3. Save the form to persist via the FastAPI router; the experiment immediately appears in the catalog table and the detail column.
4. Use the inline status form to transition from draft → running and optionally set a feature flag key that the storefront can read.
5. Log initial telemetry via the “Log metrics” widget so downstream PDP/checkout messaging has context before live traffic arrives.

## Storefront Experiment Messaging

Active pricing experiments now surface across the storefront:

1. **Product detail badge** – PDP hero sidebars include a “Dynamic pricing lab” card whenever a running/paused experiment targets the product and its `featureFlagKey` is listed in `NEXT_PUBLIC_FEATURE_FLAGS`. Variants display their deltas/multipliers so ops can sanity check copy before rollout.
2. **Checkout summary notice** – the order sidebar reiterates which cart lines are part of the trial and lists the configured variants, reinforcing that pricing may fluctuate while telemetry is gathered.
3. **Journey context payload** – checkout API calls embed the active experiment metadata under `journeyContext.pricingExperiments`, giving FastAPI + downstream automations a reliable record of which trials influenced each order.

Enable a given experiment customer-side by setting `NEXT_PUBLIC_FEATURE_FLAGS=flag_one,flag_two` in the web app environment; omit the flag to keep the test dark while still visible in admin. Paused/completed experiments are automatically filtered from customer surfaces.

## Implementation Tracks

### Frontend
- Rebuild storefront layout (Next.js app routes) with reusable marketing components, hero modules, PLP filters, PDP blocks, upsell/gamification widgets.
- Extend checkout, cart, and account pages to support saved profiles, prefilled configs, billing forms, invoice downloads, and surfaced loyalty projections tied to cart snapshots.
- Introduce analytics/reporting surfaces for both customer and admin dashboards (charts, tables, KPIs).

### Backend & APIs
- Expand `/api/v1/products` responses to include platform eligibility, trust metrics, and configuration presets needed by new UI modules.
- Add `/api/v1/accounts/profile` endpoints for addresses, billing info, saved platforms, and invoice retrieval.
- Enhance `/api/v1/orders` to emit invoice metadata, provider telemetry, journey runtime results, and loyalty projection metadata for customer consumption (documented in `docs/storefront-loyalty-context.md`).
- Tighten provider orchestration: map product configs → provider jobs → refill loops with telemetry surfaced via APIs.
- Launch `/api/v1/catalog/pricing-experiments` for defining variants, updating status, and recording telemetry so storefront merchandising can programmatically run price tests.

### Data & Telemetry
- Define canonical events for storefront interactions (product view, upsell click, reward redemption, quick-order launch).
- Extend journey runtime telemetry ingestion to power dashboards + customer timeline views.
- Build summary tables for “track how your account performs” (spend, delivery, success rate, reward impact) accessible to both admin and customers.

## Next Steps
1. Socialize this roadmap with the merchandising + web teams and align on sequencing relative to Iteration 4 backend work.
2. Break down each phase into actionable issues/trackers (e.g., `docs/product-merchandising-enhancement-plan.md` for backend, new UX epics for storefront/account work).
3. Ensure telemetry + data contracts (see `docs/storefront-loyalty-context.md` for the current cart snapshot contract) are agreed upon before building dashboards, so storefront/admin views stay in sync.
4. Extend loyalty projections deeper into success + account rituals (UI + API) whenever new checkout features land so messaging, automation, and documentation stay aligned.
5. Fold pricing experiment telemetry into merchandising surfaces once the `/api/v1/catalog/pricing-experiments` contract stabilizes—PDP badge experiments, checkout incentives, and loyalty nudges should all read from the same snapshot.
