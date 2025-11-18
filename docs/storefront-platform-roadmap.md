# Storefront & Platform Experience Roadmap

## Purpose
Capture the end-to-end vision for a production-ready “shop → buy → operate” flow that pairs the merchandising system with a delightful storefront, platform-aware ordering, and trustworthy lifecycle touchpoints. This roadmap complements `docs/product-merchandising-enhancement-plan.md` by detailing the UX, customer-facing commerce, and reporting layers that still need to be built.

## Guiding Principles

1. **Shop-first, platform-aware** – Every surface (home, PLP, PDP, checkout, account) should reinforce “Buy for *your* channel” with saved platform contexts, suggested configs, and direct deep links from account dashboards.
2. **Trust through transparency (with restraint)** – Surface delivery and verification data where it helps customers make decisions, but avoid exposing low-level provider telemetry or experimental pricing states that erode confidence.
3. **Persisted commerce data** – Customers can manage billing profiles, addresses, invoices, and order history; admins see the same details plus provider telemetry, refills, and alerts.
4. **Motivation over gamification** – Loyalty nudges and progress cues should remain optional enhancements layered on top of a reliable purchase→delivery loop; badges/streaks should never block or distract from the core flow.
5. **Operational parity** – Provider routing, refill triggers, and metrics span admin dashboards, automation runbooks, and customer views.

## Experience Pillars

| Pillar | Scope |
| --- | --- |
| **Immersive Storefront** | Homepage hero + PLP + PDP with trust metrics, upsells, testimonials, and contextual CTAs (de-emphasise game mechanics). |
| **Platform-centric Ordering** | Save Instagram/TikTok accounts, pre-fill product configurations, launch purchase flows from account dashboards, and map products to eligible platforms. |
| **Commerce Foundations** | Persistent address/contact book, invoice generation/downloads, tax profiles, payment metadata, and order lifecycle telemetry surfaced for both customers and admins. |
| **Metric Sourcing & Verification** | Account validation UX, scraper/API sourcing, baseline/delivery snapshots, and fraud controls spanning storefront + fulfillment. |
| **Insights & Reporting** | Admin-first reporting (provider telemetry, SLAs, cursors, guardrails) with carefully curated customer views once delivery proof is reliable. |
| **Retention Programs (Later)** | Loyalty tiers, referral boosters, pricing experiments, and dashboards once transaction reliability + repeat purchasing are proven. |

## Execution Tracks & Phases

The prior roadmap interleaved storefront polish, gamification, loyalty, and automation. To reduce complexity, we now sequenced work into four tracks. Every subsequent phase assumes the previous one is healthy in production.

### Track Status Snapshot (May 2025)
- **Track 0 – Foundation (~72%)**: Readiness probes, receipt storage, delivery proof insights, quick-order telemetry, and guardrail evidence capture are live. Remaining work focuses on scaling probes and wiring SLA automation dashboards.
- **Track 1 – Commerce & Storefront (~45%)**: Unified PLP/PDP flows, configurator presets, and quick-order prefill are launched; outstanding work includes cart/checkout auto-consumption of quick-order params, billing UX polish, and mobile QA.
- **Track 2 – Operations & Insights (~42%)**: Guardrail alerts, workflow board, sticky queue filters, and telemetry exports (quick-order snapshot card + Snowflake comparison) are shipping, along with the new GuardrailWorkflowTelemetry card that summarizes Slack composer + queue evidence. Next step: persist attachments in FastAPI feeds, expose workflow analytics, and round out automation UI (auto-pause/escalate rules, Snowflake feeds).
- **Track 3 – Loyalty & Growth (~18%)**: Loyalty wiring and experiments exist, but dashboards/gamified surfaces remain future work until Track 0/1 harden.

### Track 0 – Foundation (P0)
Establish the minimum viable “shop → validate → deliver → prove” loop before layering revenue optimizations.

1. **Metric sourcing & validation**
   - Build `MetricSourcer` abstractions with third-party scraper integrations (fallback to manual entry) and debounce validation UX (`AccountInput`, `AccountPreview` components).
   - Persist validated accounts in `customer_social_accounts` with metadata, ownership verification evidence, and snapshot history (`baseline_metrics`, `delivery_snapshots`).
   - Document failure behaviors (private/deleted accounts, rate limits) and admin overrides.
2. **Account ownership & fraud controls**
   - Require proof of control (temporary bio/DM code) for high-risk services.
   - Detect referral/loyalty abuse (point reversals, duplicate accounts, refunds).
3. **Order state machine + provider abstraction**
   - Formalize states (pending → processing → delivered/refill/refund) with audit logging (actor, timestamp, metadata).
   - Implement provider adapters with consistent submit/check/refill interfaces and quality scoring.
   - Define policies for provider failures, refill retries, and timeline communication.
4. **Delivery verification UX**
   - Before/after metric cards, drip progress bars, and admin tooling to inspect delivery snapshots.
   - Background jobs to poll metrics during delivery windows while respecting rate limits.

### Track 1 – Commerce & Storefront (P1)
Once Track 0 is stable in staging, reintroduce the storefront/checkout roadmap items (Phases 1–3 condensed):

1. **Storefront foundation** – homepage, PLP, PDP, cart, checkout polish with trust overlays sourced from real delivery data.
2. **Platform-aware ordering** – saved handles, quick-order CTAs, platform health widgets (read-only until metric sourcing is dependable), channel deep links.
3. **Commerce/billing essentials** – profiles, invoices, `/account/orders` parity with `/admin/orders`, taxes/compliance.
4. **Mobile-first QA** – ensure the entire Track 0/1 flow is responsive and accessible before scaling traffic.

_Next iteration:_ prepare the platform-aware ordering ticket that consumes delivery proof telemetry (blueprint metrics + receipt probe status) so quick-order flows can surface real trust context.

- **New:** Account orders now render a “Quick-order trust snapshot” card that blends live delivery proof metrics, provider telemetry summaries, guardrail workflow telemetry (attachment usage + snippet activity), and the receipt storage probe status so shoppers can validate a platform before launching the quick-order modal. The CTA opens an in-app workflow that pre-seeds `/products` with the active handle + product ID, so shoppers land on the right builder instantly.
- `/admin/onboarding` mirrors the same telemetry: the Quick-order funnel card now embeds the guardrail workflow summary so ops can confirm Slack composer activity (uploads, copies, provider streaks) while comparing local vs. Snowflake funnel metrics. Both storefront and admin trust cards hydrate via the shared hook, so status labels stay in sync with `/api/reporting/guardrail-workflow` caches. `/admin/reports` reuses the same hook inside the Quick-order export card so ops see export parity, NDJSON downloads, and live workflow actions in one glanceable panel.
- **Update:** Quick-order launches now mint short-lived sessions that auto-highlight the referenced product, restore blueprint selections on the PDP, and emit `quick_order.start/abort/complete` telemetry events (including delivery-proof + provider summaries) so ops can trace how often shoppers follow through.
- **Update:** The guardrail workflow board now exposes interactive queue cards with auto-pause/resume/escalate buttons that log follow-ups via `/api/reporting/guardrail-followups` and emit telemetry so Slack handoffs stay in sync.
- **New:** Slack workflow composer supports screenshot/receipt attachments powered by the shared asset upload service; uploaded links auto-insert into the snippet and emit `guardrail.workflow` telemetry so attachment usage is tracked alongside copy events.
- **Update:** Guardrail follow-ups now persist attachment metadata through FastAPI, so the queue, Slack composer, and timelines replay due diligence evidence everywhere without copy/paste. The UI gained inline uploaders (shared signer) and historical attachment previews so ops can reuse existing proof before logging new actions.

### Track 2 – Operations & Insights (P2)
Focused on internal tooling and ops velocity; customer exposure stays minimal.

1. **Admin automation & guardrails** – continue evolving `/admin/reports`, guardrail follow-ups, provider alerts, and export workflows (already in progress). Provider telemetry surfacing is shared with the backend plan documented in `docs/product-merchandising-enhancement-plan.md`, so ops/admin views stay aligned with automation contracts.
2. **Delivery dashboards** – provide admins with SLAs, provider quality, backlog/alerting. Customer “Performance” dashboard remains gated until we have trustworthy delivery proof.
3. **Support tooling** – admin order editor, refund triggers, dispute workflows tied to the state machine + audit trail.
   - _Upcoming ticket_: design the guardrail automation workflow UI (Slack + `/admin/reports`) that reuses the new provider telemetry summary chips.

#### Provider Automation Telemetry (Shared Contract)
- `/api/v1/reporting/guardrails/followups` now returns a `providerTelemetry` payload backed by the backend’s `ProviderAutomationTelemetry` schema (see `docs/product-merchandising-enhancement-plan.md`). Slack guardrail alerts, the weekly digest, and `/admin/reports` all hydrate this object as-is, so schema changes have to be coordinated across surfaces.
- The Next.js helper at `@/server/reporting/guardrail-followups` sanitizes the payload (verifying `totalOrders` is finite) before fanning out to `ProviderAutomationDrawer`, Guardrail Follow-Up timelines, and provider alert drawers. Keep future UI work (guardrail automation workflow, alert digests) wired through this helper so data fetching stays centralized.
- When altering the telemetry contract, update `@/lib/provider-service-insights` + `@/types/reporting.ts` first, then mirror the change in Slack/email templates. This keeps automation runbooks, guardrail notifiers, and admin feeds aligned.
- Guardrail alerts in `/admin/reports` now surface a live Slack handoff snippet per provider (with copy-to-clipboard UX) that includes guardrail counts, replay status, provider telemetry hotspots, conversion links, and the latest follow-up notes, ensuring Slack notifiers and dashboard escalations stay perfectly in sync.

#### Data & Telemetry Enhancements
- **Track 2 “Data & Telemetry”** now ships the GuardrailWorkflowTelemetry card on `/admin/reports`, which digests `.telemetry/guardrail-workflow-events.ndjson` (and the same summary exposed to Slack) alongside the Snowflake/local quick-order export comparison card. Sticky guardrail queue filters persist provider/severity slices, `.github/workflows/guardrail-workflow-telemetry-export.yml` now mirrors NDJSON + status JSON into S3, provider automation history runs and Slack/email digests ingest the same summary via `GUARDRAIL_WORKFLOW_TELEMETRY_SUMMARY_URL`, and `docs/runbooks/quick-order-telemetry-export.md` / `docs/runbooks/guardrail-workflow-telemetry-export.md` plus `docs/data-lake.md` document both payloads so ops can reconcile telemetry without digging through code.
- A shared SWR hook now powers guardrail workflow telemetry across storefront and admin surfaces (quick-order trust snapshot, ProviderAutomationHistoryPanel, AutomationStatusPanel, and GuardrailWorkflowTelemetryCard). Each surface renders server-fetched summaries instantly, then revalidates via `/api/reporting/guardrail-workflow`, so Slack digests, dashboards, and storefront trust cards stay in lockstep without bespoke polling code.
- `.github/workflows/quick-order-telemetry-export.yml` mirrors `/api/telemetry/quick-order/export` NDJSON into Snowflake-ready S3 buckets and publishes a JSON status snapshot (`syncedAt`, `events`, aggregated funnel metrics). `/admin/reports` and `/admin/onboarding` consume that snapshot to render a quick-order export card with delta sparklines, download buttons (local + Snowflake), and a toggle between local telemetry and warehouse aggregates.
- Guardrail follow-up queue filters now persist via URL params + `localStorage`, so provider/severity deep links reopen the exact queue context. Conversion cursor pins already existed; the sticky filters keep guardrail health dashboards, Slack links, and `/admin/reports` cards aligned without manual reconfiguration.

### Track 3 – Loyalty, Experiments & Retention (P3)
Enable only after repeat purchase behavior and delivery proof exist.

1. **Pricing experiments (admin-facing only at first)** – hide variant labels from storefront until validated; ops dashboards already support guardrails.
2. **Loyalty + referrals** – reintroduce points/badges with clear fraud protection and automatic reversals on refunds.
3. **Customer-facing insights** – limited “Performance” dashboard surfaces aggregated metrics (delta from baseline, on-time delivery streaks) without exposing provider failures. Gamification elements remain secondary.
   - _Upcoming ticket_: prototype the performance dashboard IA using the provider telemetry summary (guardrail hotspots, replays, overrides) as the canonical data contract.

### Phase 1 – Storefront Foundation (Re-sequenced into Track 1)
1. **Homepage revamp**: hero, product highlights, testimonials, trust badges tied to real metrics.
2. **Product listing (PLP)**: filterable cards with pricing tiers, channel eligibility chips, reward hints.
3. **Product detail (PDP)**: enhanced component sections (journey bindings, fulfillment insights, upsells, “what you’ll track”), plus interactive configurator in-page.
4. **Cart UX**: persistent mini-cart, saved configurations, and inline upsell prompts.
5. **Checkout polish**: progressive disclosure forms, summarized trust metrics, callouts for loyalty/rewards, error handling improvements.
6. **Navigation & context**: sticky nav with storefront-wide channel selector, search, and quick links to loyalty/account so the user’s platform context is always visible.
7. **Trust overlays**: tooltip and modal components that explain delivery SLAs, provider coverage, and experiment disclosures without leaving the flow.

### Phase 2 – Platform-Aware Ordering (Track 1)
1. **Account platform profiles**: allow users to connect/manage Instagram/TikTok/etc. handles with metadata (followers, goals).
2. **Quick order from account dashboard**: CTA per platform to open a modal-based configurator that seeds the cart and jumps to checkout.
3. **Product-platform eligibility map**: admin toggle to mark products for specific platforms; storefront respects these filters automatically.
4. **Journey component context**: propagate platform metadata into journey runtime requests to seed bindings for scripts.
5. **Channel-deep-linking**: PLP/PDP deeplinks carry `?platform={handle}` so shoppers arriving from lifecycle emails land in the right context with prefilled configs.
6. **Platform health widgets**: account dashboard cards summarizing reach, recent deliveries, and recommended products per platform, driving targeted upsells.
   - _Telemetry card_: the upcoming quick-order modal should reuse the provider telemetry summary (total orders, guardrail hits, overrides, probe status) plus blueprint metrics so shoppers see real trust context before committing.

### Phase 3 – Commerce & Billing Essentials (Track 1)
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
2. **Admin aggregate dashboards**: success/failure funnels per product, platform, provider, and journey component with deep links into `/admin/reports` + `/admin/onboarding`.
3. **Concierge experiment analytics**: productionize the new trend sparklines + guardrail breakdowns, add drill-down tables (conversion vs. stalled) and “Focus journeys / Export CSV” shortcuts so ops can react immediately.
4. **Provider refill workflow**: expose refill triggers + history in admin + customer order details, with notifications when refills complete.
5. **Telemetry bridge**: unify journey runtime telemetry, provider metrics, loyalty events, and experiment analytics into a warehouse-ready feed for reporting + guardrail automation.

### Phase 6 – Dynamic Pricing & Merchandising Intelligence
1. **Guardrail orchestration**: wire concierge analytics thresholds (stalled %, conversion deltas) into workflow automations that alert Slack/webhook subscribers, optionally pause variants, and annotate `/admin/onboarding` cards with guardrail badges.
2. **Storefront + lifecycle awareness**: ensure PDP/checkout badges, loyalty dashboards, receipts, and lifecycle emails reference experiment performance (not just the assigned variant) so customers see why pricing shifted.
3. **Customer dashboards w/ experiment context**: extend the “Performance” dashboard to show how experiments influenced spend, rewards, and delivery outcomes per platform, mirroring the admin analytics.
4. **Telemetry feedback loops**: route pricing experiment metrics into loyalty + journey context to backstop incentives (“this tier unlocked the spring-offer variant”) and feed future guardrail ML/heuristics.
5. **Concierge experiment insights**: continue evolving `/api/v1/operators/onboarding/journeys` filters + analytics (trend cards, drill-down tables, export links) so ops can triage journeys by active trials without digging into notes.
6. **Loyalty deep links & messaging parity**: `/account/orders`, `/account/loyalty`, and lifecycle emails keep echoing the same slug, variant name, and guardrail status, ensuring concierge scripts + automated comms stay aligned while experiments rotate.

## Customer Journey Narrative

1. **Discover → Learn** – A visitor lands on the hero, views featured bundles, and scrolls through social proof. Context chips (platform selector, loyalty tier progress) immediately clarify which channels/products apply to them.
2. **Evaluate → Configure** – From PLP to PDP, the shopper inspects component cards (journey steps, fulfillment timelines, concierge perks) before launching the inline configurator. Add-on drawers, pricing experiment callouts, and trust tooltips reduce uncertainty.
3. **Commit → Checkout** – The cart and checkout surfaces summarize loyalty perks, experiment variants, delivery guarantees, and required custom fields. Progressive disclosure forms collect billing + platform info while preserving saved profiles.
4. **Confirm → Celebrate** – Success pages explain what was purchased, which experiment variant applied, projected reward earnings, and next concierge steps. Customers can share the purchase or jump directly to account tracking.
5. **Operate → Grow** – Account dashboards expose platform performance, order history, invoices, refill controls, reward redemptions, and quick-order CTAs. Experiment context flows through receipts, loyalty modules, and lifecycle emails so customers understand how pricing may evolve.
6. **Support → Iterate** – Concierge nudges (manual + automated) leverage the same telemetry to suggest guardrail actions, upsells, or loyalty boosts. `/admin/onboarding` analytics ensure ops sees exactly what the customer saw.

## Component & Surface Inventory

| Surface | Key Components / Notes |
| --- | --- |
| Homepage | Hero carousel, platform selector, testimonial slider, rewards strip, experiment spotlight carousel, CTA tiles linking to PLP sections. |
| PLP | Filter rail (platform, price, reward, experiment tag), product cards with trust badges, quick-config modals, infinite scroll with status beacons (new, experiment, low inventory). |
| PDP | Modular layout: overview hero, journey breakdown accordion, fulfillment timeline, pricing experiment badge, upsell carousel, FAQ/trust tabs, inline configurator + add-on drawers. |
| Cart & Checkout | Persistent summary drawer, loyalty projection widget, experiment disclosure pill, address/book selectors, payment pane, error/validation inline states, CTA for quick reorder. |
| Account | Platform dashboard cards, order timeline component, invoice list, loyalty hub, quick-order modals, saved configurations, experiment history per order. |
| Admin Counterparts | `/admin/merchandising` option matrix editor, `/admin/onboarding` analytics panel, `/admin/reports` export table, guardrail alert inbox, pricing experiment CRUD forms. |

Every component requires responsive variants (mobile-first stacks, accessible focus states, motion guidelines) and shared tokens (colors, typography) so storefront + admin surfaces feel cohesive.

## Experience Architecture & Flow Requirements

- **State management**: Use a single source of truth (React context/Zustand) for platform selection, loyalty tier, and experiment exposure so every surface reads the same data without prop drilling.
- **URL contracts**: Standardize query params (`platform`, `experiment`, `loyaltyCampaign`) for deep links from marketing emails, concierge Slack, and admin dashboards to storefront/account screens.
- **Error recovery**: Provide non-destructive flows—autosave configuration drafts, show inline validation with remediation tips, and allow fallback contact/concierge chat when automation fails.
- **Content governance**: Define CMS slots for hero copy, trust proof points, experiment explanation copy, and concierge scripts to keep messaging consistent as experiments rotate.
- **Visual QA**: Build Storybook stories per component state (default, experiment, guardrail alert) and smoke tests for the full journey (PLP→cart→success→account) so regressions are caught before launch.

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
4. **Receipts + account archive segmentation** – success pages and `/account/orders` now surface the assigned variant for every experiment and send an analytics event with `{slug, variantKey, variantName, assignmentStrategy}` so dashboards, loyalty nudges, and campaign tooling can slice conversions per variant.

Enable a given experiment customer-side by setting `NEXT_PUBLIC_FEATURE_FLAGS=flag_one,flag_two` in the web app environment; omit the flag to keep the test dark while still visible in admin. Paused/completed experiments are automatically filtered from customer surfaces.

## Implementation Tracks

### Frontend
- Rebuild storefront layout (Next.js app routes) with reusable marketing components, hero modules, PLP filters, PDP blocks, upsell/gamification widgets.
- Extend checkout, cart, and account pages to support saved profiles, prefilled configs, billing forms, invoice downloads, and surfaced loyalty projections tied to cart snapshots.
- Introduce analytics/reporting surfaces for both customer and admin dashboards (charts, tables, KPIs).
- Build a shared component library (Hero, PLP Card, PDP Module, Cart Drawer, Checkout Form, Loyalty Banner, Account Timeline) with Storybook stories covering default/experiment/guardrail states and accessibility checklists.
- Implement responsive layouts + theming tokens so storefront + admin share typography/color/motion primitives, reducing drift.

### Backend & APIs
- Expand `/api/v1/products` responses to include platform eligibility, trust metrics, and configuration presets needed by new UI modules.
- Add `/api/v1/accounts/profile` endpoints for addresses, billing info, saved platforms, and invoice retrieval.
- Enhance `/api/v1/orders` to emit invoice metadata, provider telemetry, journey runtime results, and loyalty projection metadata for customer consumption (documented in `docs/storefront-loyalty-context.md`).
- Tighten provider orchestration: map product configs → provider jobs → refill loops with telemetry surfaced via APIs.
- Launch `/api/v1/catalog/pricing-experiments` for defining variants, updating status, and recording telemetry so storefront merchandising can programmatically run price tests.

### Data & Telemetry
- Define canonical events for storefront interactions (product view, upsell click, reward redemption, quick-order launch).
- Instrument quick-order journeys end-to-end (start/dismiss/add-to-cart) now that telemetry scaffolding exists; feed these events into guardrail automation dashboards.
- Capture guardrail workflow telemetry across queue actions and Slack composer interactions (copy, attachment upload/remove/copy) so automation dashboards, digests, and workflow reviews share the same dataset.
- Persist quick-order telemetry via the proxy endpoint (and the new `/api/telemetry/quick-order` capture route when events skip the proxy), rotate local NDJSON logs, and surface funnel metrics (start/abort/complete counts, reasons, completion rates) inside `/admin/onboarding` + `/admin/reports` so ops can correlate storefront behavior with experiment performance.
- **New:** `/api/telemetry/quick-order/export` now streams the `.telemetry/quick-order-events.ndjson` retention window so GitHub Actions or cron jobs can mirror funnel data into Snowflake/S3. See `docs/runbooks/quick-order-telemetry-export.md` for curl + workflow templates.
- ✅ `.github/workflows/quick-order-telemetry-export.yml` now runs every 30 minutes, mirroring the export route into S3 and pinging Slack when events land (or when no events exist yet). Next iteration: stitch the exported NDJSON into the `/admin/reports` analytics overlays so ops can compare Snowflake aggregates vs. the local funnel in real time.
- Extend journey runtime telemetry ingestion to power dashboards + customer timeline views.
- Build summary tables for “track how your account performs” (spend, delivery, success rate, reward impact) accessible to both admin and customers.
- Stream pricing experiment segmentation events (success page + account receipts) so analytics dashboards and loyalty programs can filter conversions by `{slug, variantKey, assignmentStrategy}` without scraping notes.
- Mirror the pricing experiment feed in operator onboarding dashboards so concierge teams immediately see which variants influenced a journey and can filter stalled tasks by active experiment.
- Ship self-serve CSV exports in `/admin/onboarding` (download & pagination controls that proxy `/api/reporting/onboarding/experiment-events`) so concierge leads can deliver telemetry to merchandising/analytics instantly.
- Patch `/api/v1/reporting/*` exports, analytics API routes, and the onboarding data-lake job to include normalized `pricingExperiments` metadata so BI tables, CSV exports, and concierge dashboards all show the same exposure/conversion counts (documented in `docs/data-lake.md`).
- Automate experiment exports via GitHub Actions + webhook sinks, persisting cursor checkpoints in S3/GCS so the data lake remains synchronized without manual intervention or DB access from CI.
- Stand up a `/admin/reports` command center that combines CSV controls, automation health (latest rows + `nextCursor`), and links to data-lake pipelines so ops can validate telemetry without digging through logs or notebooks. Wire the automation workflow into Slack/Teams webhooks for proactive alerting. ✅ Initial page now renders export controls, guardrail alerts backed by `/api/v1/fulfillment/providers/automation/status`, automation workflow status from the same endpoint, and the shared experiment analytics panel. ✅ Provider automation snapshot + run history now render live data from `/api/v1/fulfillment/providers/automation/*` so ops teams can audit guardrail posture without leaving the dashboard.
- Extend the telemetry model to tag every event with `{platformSlug, loyaltyTier, experimentSlug, experimentVariant, guardrailStatus}` so dashboards and guardrail automation consume identical payloads. ✅ TypeScript contracts now live in `@/types/reporting.ts` with stub dispatchers in `@/lib/telemetry/events.ts`.
- Persist `platformContext` from storefront → checkout payloads → FastAPI order items so success pages, account receipts, and onboarding analytics know which channel each line supports. ✅ Checkout now writes `order.items[].platform_context`, the API echoes it back to storefront clients, chips render on checkout success + account history, and onboarding journeys capture the same metadata for automation workflows.
- Expand automation analytics to log guardrail follow-ups per platform channel. ✅ Notes now persist via `POST /api/v1/reporting/guardrails/followups` and paginate via the new `GET /api/v1/reporting/guardrails/followups?providerId=` feed, `/admin/reports` renders a follow-up history accordion (with “Load more” support) for every alert, and `/admin/fulfillment/providers` surfaces the same timeline so provider detail views inherit the logged actions automatically. ✅ Guardrail alert enrichment now hits the cached `GET /api/v1/fulfillment/providers/platform-contexts` endpoint and the Slack notifier now annotates alerts with suspected platform chips, so operators see the same context whether they live in the dashboard or Slack. ✅ Snowflake exporters + Looker snippets now rely on the same platform-context + conversion cursor columns documented in `docs/data-lake.md`, and the new catalog QA escalation macros bake those fields into every Slack snippet. Next up: wire the guardrail export artifacts directly into `/admin/reports` download controls so ops can fetch the warehouse-ready NDJSON without hitting Actions/S3.
- Persist guardrail pause/resume status across the stack. ✅ Follow-up writes now update `provider_guardrail_status`, `/admin/reports` queues pull the authoritative state (even when the paginated feed trims older entries), and every guardrail card shows a “Paused” badge sourced from the backend cache. ✅ Pause/Resume actions fire the Slack template automatically using the provider automation alert webhook so ops rooms get notified without manual copy/paste.
- Provider automation alerts worker now auto-applies the guardrail playbook: critical breaches trigger an automatic `pause` follow-up (persisted + Slack’d), and once telemetry clears the worker records a `resume` follow-up so dashboards and ops rooms stay aligned even if nobody clicks the UI buttons.
- Surface auto guardrail context everywhere operators work. ✅ Provider automation Slack notifications now append a `:robot_face:` digest listing every provider that was automatically paused or resumed (with links back to `/admin/fulfillment/providers/[id]?tab=automation`), the automation cadence card on `/admin/reports` surfaces the same pause/resume chips inline, and the run history list renders matching chips + summary text so ops can audit each worker invocation without digging through raw JSON.
- Extend the experiment analytics panel with conversion snapshots. ✅ `/admin/reports` and `/admin/onboarding` now show per-slug order + journey counts (latest activity timestamps) sourced from the onboarding experiment feed so ops can gauge conversion traction without leaving the dashboard. ✅ Conversion cards now aggregate `/api/v1/reporting/onboarding/experiment-events` with order totals + loyalty projections so ops see revenue impact (“$ per slug” + loyalty points) alongside counts. ✅ Provider automation Slack digests and the weekly operator digest emails now append a moneybag section that surfaces the top conversion slugs (revenue, orders, journeys, loyalty points, last activity), and the GitHub/webhook automation exports ship the same revenue + loyalty columns for downstream sinks. Next step: pipe those KPIs straight into the Snowflake telemetry tables + revenue dashboards so external analytics teams inherit the enriched schema.
- Conversion paginator state now syncs to `?conversionCursor=` on `/admin/onboarding` and `/admin/reports`, so deep-links reopen the same slice; the client widget updates the URL via `history.replaceState` and Jest coverage ensures the cursor + fetch mechanics stay stable. ✅ The conversion card now renders a historical cursor badge + hint when that query param is active, and `/admin/reports` includes a deeplink pill (“Clear conversions cursor”) near the top nav so ops can immediately jump back to the live snapshot without scrolling to the reset button.
- Replace the experiment analytics stub on `/admin/reports` with live trend + variant guardrail data sourced from `/api/v1/reporting/onboarding/experiment-events`. ✅ The panel now aggregates the latest export rows (sparklines + active v. stalled counts) on the server so ops can see experiment health without bouncing to `/admin/onboarding`.
- Hook guardrail alerts into follow-up logging so ops can tag each breach with a quick action (pause/escalate/resume) and emit telemetry. ✅ Guardrail cards now include inline follow-up controls that call `trackGuardrailAutomation` and hydrate automation logs with contextual notes.

## Immediate Next Steps

1. **Ship the metric sourcing testbed** – ✅ `customer_social_accounts` + `MetricSourcer` service now back `/admin/reports` (account validation testbed) and the CLI harness. Next: wire delivery proof UI + provider metrics on top of the stored snapshots.
2. **Model customer social accounts** – Create `customer_social_accounts` + `order_items` references (`baseline_metrics`, `delivery_snapshots`, `target_metrics`) with ownership verification signals.
3. **Define the order state machine** – ✅ FastAPI now enforces the Track 0 state graph (`pending→processing→active→completed/on_hold/canceled` plus refill reopen), persists audit logs (`order_state_events`), and `/admin/orders` renders the new Order timeline card. Next: wire provider auto-actions into this log + expose refill/refund shortcuts.
4. **Document provider adapters** – List current providers, their APIs, SLAs, and map them into the unified interface with quality scoring + cost calculations.
5. **Prototype delivery proof UI** – ✅ Delivery proof cards on `/admin/orders` read `customer_social_accounts` snapshots via `GET /orders/{id}/delivery-proof` so ops can review baseline/latest metrics. ✅ `/api/v1/orders/delivery-proof/metrics` now aggregates those snapshots per SKU and the storefront trust pipeline (checkout, PDP, trust preview) consumes the real follower lift + sample sizes instead of static copy. ✅ Storefront receipts, checkout success, `/account/orders`, JSON exports, payment-success emails, and the downloadable PDF now share the live payload. ✅ PDFs also capture provider automation telemetry + compliance signature blocks, and `/api/v1/health/readyz` exposes a `receipt_storage` check so ops can watch archival health. ✅ The new receipt storage probe writes/reads/deletes sentinel PDFs via `receipt_storage_probe_worker` (or `tooling/scripts/run_receipt_storage_probe.py`) and persists telemetry so `/readyz` callers see the last success/error timestamps. Next iteration: expand the automated probe (size budgets, multi-object samples) and document the runbook so compliance can validate retention windows.
6. **Defer gamification-facing work** – Loyalty tiers, badges, public experiment badges, and the customer “Performance” dashboard remain gated behind Track 3; focus on reliable commerce + ops telemetry first.

## Cross-Cutting Architecture

- **Shared Context Store**: `@/context/storefront-state` now wraps the root layout with a Zustand-powered provider exposing `usePlatformSelection`, `useLoyaltySnapshot`, and `useExperimentExposure`. Session data persists via `localStorage` + `smplat_storefront_state` cookie so SSR routes and server components hydrate with consistent context. Admin tools reading storefront context (e.g., previewing guardrail UI) consume the same provider. The main navigation pill + PLP filters + cart/checkout/loyalty surfaces now read/write this store (and URL params) so saved platform context flows through browse → configure → pay → follow-up.
- **URL Schema**: standardize query parameters (enforced via `@/lib/storefront-query.ts` helper):
  - `platform`: slug/handle (e.g., `instagram:@brand`).
  - `experiment`: slug.
  - `variant`: variant key.
  - `loyaltyCampaign`: campaign slug (maps to CRM workflows).
  Document the schema in `docs/storefront-loyalty-context.md` and enforce via helper functions to avoid typos.
- **Design Tokens & Theming**: centralize colors/typography/motion tokens in `packages/ui` (or similar) so storefront + admin share consistent brand language. Include experiment/guardrail alert colors for parity.
- **Content Contracts**: define CMS fields for hero copy, trust tooltips, experiment disclaimers, concierge scripts. Require localized variants where applicable and tie each piece to a component slot map.

## Next Steps
1. Socialize this roadmap with the merchandising + web teams and align on sequencing relative to Iteration 4 backend work.
2. Break down each phase into actionable issues/trackers (e.g., `docs/product-merchandising-enhancement-plan.md` for backend, new UX epics for storefront/account work).
3. Ensure telemetry + data contracts (see `docs/storefront-loyalty-context.md` for the current cart snapshot contract) are agreed upon before building dashboards, so storefront/admin views stay in sync.
4. Extend loyalty projections deeper into success + account rituals (UI + API) whenever new checkout features land so messaging, automation, and documentation stay aligned.
5. Continue folding pricing experiment telemetry into merchandising surfaces: PDP/checkout badges already reference live variants, success/account flows record assignments, and analytics receive an explicit event, so guardrail automation can now pivot on those same fields. The new `ExperimentAnalyticsService` + `/api/v1/reporting/onboarding/experiment-conversions` endpoint expose the top conversion KPIs for Slack, weekly digests, and `/admin/reports`; **routing this payload into Snowflake is intentionally deferred** until the broader data warehouse program is resumed, so we can focus on concierge tooling first.
6. Design + implement the guardrail automation workflows described in Phase 5/6 (alerts, auto-pauses, drill-down tables) and keep `/admin/reports` + `/admin/onboarding` aligned with the same analytics APIs. Use the conversion snapshot helper to inform `/admin/reports` badges and Slack runbooks when reviewing guardrail actions so concierge teams see consistent KPIs before triggering pause/resume flows.
7. Outline the customer-facing “Performance” dashboard requirements (Phase 5) so they track experiment slugs/variants alongside spend and loyalty impact, mirroring the concierge analytics we just added. The dashboard IA should explicitly call out where the conversion snapshot data will land so it stays in lockstep with Slack/digest KPIs.
8. Break down the component inventory into build tickets (Hero/PLP card/Configurator/Account modules) with Storybook coverage, accessibility acceptance criteria, and mobile specs.
9. Lock in shared state + URL contracts (platform selection, experiment params, loyalty context) before shipping Phase 2+ features so all surfaces stay in sync.
10. Define `/admin/reports` guardrail automation backlog: alert thresholds, Slack message templates, “auto-pause variant” workflow, and a runbook card linking to concierge dashboards.
11. Draft the customer “Performance” dashboard IA (widgets, charts, experiment filters) and ensure its data dependencies line up with the telemetry bridge described above. ✅ `docs/performance-dashboard-plan.md` now catalogs the IA, widget requirements, and upstream data sources so design/dev can iterate without duplicating context.
12. Schedule usability tests covering the customer journey narrative (discover → operate) with prototype artifacts to validate navigation, configurator flow, experiment messaging, and loyalty rewards comprehension before heavy engineering investment.
13. ✅ Guardrail automation parity: `/admin/reports` and `/admin/onboarding` now share the same auto-action chips (deep links + ranAt tooltips), the journey drawer renders the linked provider follow-up timeline/status inline, multi-provider journeys expose a selector so ops can pivot between automation feeds per provider, and guardrail follow-up/telemetry payloads now tag every action with the provider ID so analytics exports + Snowflake sinks can attribute pause/resume volume accurately. ✅ The guardrail follow-up exporter + Performance dashboard IA now document how Snowflake COPY jobs and Looker explores consume those provider-tagged rows. ✅ `/admin/reports` surfaces a guardrail export health card (cursor, rows, workflow CTA) powered by `GUARDRAIL_EXPORT_STATUS_URL`, the **Download latest NDJSON** button proxies the presigned artifact through `/api/reporting/guardrail-followups/export`, and admins can hit **Run export now** to dispatch the workflow on demand. Next up: display the most recent manual run metadata (triggered by whom/when) so concierge leads can audit emergency reruns without digging through workflow logs.
14. ✅ Conversion cursor UX: `/admin/onboarding` and `/admin/reports` now tint the conversions card when historical cursors are active, expose a server-side “Clear cursor” action, propagate the same cursor metadata into weekly digest emails + Slack digests, and the guardrail Slack template + follow-up notifier now annotate “Historical conversion slice” when `?conversionCursor=` is present. ✅ Catalog QA escalation macros now explicitly require the conversion deeplink + cursor hint, keeping merchandising alerts aligned with guardrail guidance. ✅ Guardrail alerts now include a one-click “Copy escalation snippet” button that composes those macros (provider, cursor label, platform context, follow-up link) automatically. Next up: extend the snippet helper with screenshot upload shortcuts + pre-filled attachment placeholders so merch reviewers can dispatch fully contextualized alerts without leaving the dashboard.

## Implementation Backlog (High-Level)

| Track | Items |
| --- | --- |
| **Component Builds** | Hero carousel, PLP card variants, PDP journey modules, add-on drawers, trust tooltip, loyalty banner, mini-cart, checkout stepper, success celebration module, account timeline, quick-order modal. ✅ Hero + PLP card now live in `@/components/storefront` with Storybook stories. |
| **State & Routing** | Implement shared context store, hydrate from cookies/session, normalize platform/experiment params, add middleware to redirect users missing required context. ✅ Main nav + PLP selectors now read/write the shared store and keep the `platform` query param in sync; cart, checkout, and loyalty views surface/propagate the current platform context. |
| **Telemetry & Analytics** | Update tracking plan, add experiment guardrail fields, wire `/admin/reports` analytics panel, expand data-lake schema, build Looker/Metabase dashboards for concierge + product. |
| **Guardrail Automation** | Define thresholds, implement Slack/webhook notifiers, add auto-pause endpoint, surface guardrail badges + action buttons in `/admin/onboarding` and `/admin/reports`. |
| **Customer Dashboard** | Design IA, chart components, experiment filter chips, loyalty + spend widgets, integration with invoice/order APIs, empathetic copy guidelines. |
| **Quality & Ops** | Storybook + visual regression suite, accessibility audits, responsive QA matrix, runbooks for experiments/telemetry/guardrails, success metrics instrumentation. |
