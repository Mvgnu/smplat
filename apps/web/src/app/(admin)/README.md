# Admin Route Group

This route group hosts the operator control hub. Layout expectations:

- `layout.tsx` enforces RBAC and renders the persistent sidebar + global search stub via `AdminShell`.
- All pages should expose breadcrumbs and tab navigation using `AdminBreadcrumbs` + `ADMIN_PRIMARY_TABS`.
- Shared UI primitives (tables, KPI cards, filter pills) live in `@/components/admin` and should be preferred over bespoke markup.
- Long-running server actions must surface optimistic loading states via form status or `useTransition` wrappers (see `orders/status-form.tsx` and `onboarding/manual-nudge-form.tsx`).
- The loyalty guardrail console (`loyalty/page.tsx`) pulls program telemetry from the FastAPI bridge and uses the server action
  wrapper in `loyalty/actions.ts` + `guardrail-override-form.tsx` to keep overrides optimistic and auditable.
- The merchandising surface (`merchandising/page.tsx`) hydrates product summaries, audit trails, bundle definitions, and asset
  uploads through `@/server/catalog` helpers. Use the local upload integration (`merchandising/actions.ts`) for small media
  assets and the audit restore form when rolling back an operator change.

Design tokens lean on Tailwind's dark theme: charcoal backgrounds (`#05070B` / `bg-black/30`), white typography, and blue/emerald accent glows. Extend tokens by updating `@/components/admin/README.md` alongside usage sites.
