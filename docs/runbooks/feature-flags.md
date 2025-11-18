# Feature Flag Operations Runbook

This runbook explains how to enable or disable storefront trials backed by `NEXT_PUBLIC_FEATURE_FLAGS`. Every customer-visible pricing experiment, trust pilot, or merchandising lab surface **must** ship behind one of these flags so we can graduate features gradually.

## 1. Decide which flags to flip

1. Review the admin console (`/admin/merchandising/pricing-experiments`) for the experiment slug + `featureFlagKey`.
2. Confirm the FastAPI default for that flag via infrastructure IaC or environment manifests (backend flags typically live under `FEATURE_FLAGS_DEFAULT`). Storefront overrides can only _enable_ additional flags; the backend remains the source of truth for defaults.

## 2. Update the environment variable

1. Open the web app `.env` (or deployment secret) and set `NEXT_PUBLIC_FEATURE_FLAGS` to a comma-separated list, e.g.:
   ```
   NEXT_PUBLIC_FEATURE_FLAGS=pricing_trial,badge_preview
   ```
2. Deployments that use Vercel/Render should set the same value in the platform-specific dashboard so REACT knows the flags at build/runtime.
3. After changing the variable locally, run `pnpm dev` (or restart the container) so Next.js picks up the new value.

## Environment defaults

| Environment | Default `NEXT_PUBLIC_FEATURE_FLAGS` | Notes |
| --- | --- | --- |
| Local / CI | `pricing_lab,badge_preview` | Enables all experiments so developers can vet copy. |
| Staging | `pricing_lab` | Mirrors the current staging catalog; toggle additional flags here before production. |
| Production | _empty_ | Customer-facing surfaces remain dark until explicitly enabled per experiment. |

> Keep this table synced with infra manifests. When adding a new `featureFlagKey`, update the defaults and note which tickets own the promotion plan.

## 3. Coordinate with backend defaults

1. If the backend needs the same flag enabled (for API-first consumers), update the FastAPI config map so `FEATURE_FLAGS_DEFAULT` includes the slug.
2. When toggling only on the storefront, document the variance in the experiment ticket so the backend team knows this flag is partial.

## 4. Verify customer surfaces

1. Hit a PDP that participates in the experiment: the “Dynamic pricing lab” card should render with the variant list.
2. Add the product to cart → checkout; verify the sidebar callout references the experiment.
3. Complete checkout in staging; confirm the success page shows “Pricing experiment insights” and that `/account/orders` surfaces the same variant tag.
4. Inspect FastAPI logs for `/api/v1/catalog/pricing-experiments/{slug}/events` to confirm exposure/conversion telemetry was received.

## 5. Roll back

1. Remove the slug from `NEXT_PUBLIC_FEATURE_FLAGS`.
2. Redeploy/frontend restart as above.
3. Update the FastAPI defaults if the backend flag should also be disabled.

## Rollback playbook

1. **Identify blast radius** – confirm which environments have the flag enabled (see table above) and whether backend defaults also include the slug.
2. **Disable storefront flag** – remove the slug from `NEXT_PUBLIC_FEATURE_FLAGS` (or equivalent secret) and redeploy. For urgent mitigations, restart the runtime after updating the environment variable.
3. **Disable backend default** – if `/api/v1/catalog/pricing-experiments` or other APIs rely on the same flag, remove it from `FEATURE_FLAGS_DEFAULT` so API consumers stop seeing the variant.
4. **Purge caches** – invalidate CDN caches for affected PDP/checkout routes so the updated flag state propagates immediately.
5. **Document** – add a note to the experiment ticket/runbook describing the reason for rollback, the timestamp, and any follow-up tasks before re-enabling.

> **Reminder:** All storefront feature flags are “dark by default.” When adding a new experiment, set a distinct `featureFlagKey` and update both the admin metadata and this runbook entry before shipping the code path.
