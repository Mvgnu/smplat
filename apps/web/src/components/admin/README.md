# Admin UI Primitives

These components provide the shared interaction shell and presentation primitives for the operator workspace.

- `AdminShell` renders the persistent sidebar, global search stub, and content framing.
- `AdminBreadcrumbs` standardizes hierarchy trails and optional action slots.
- `AdminTabNav` exposes pill-based navigation for surface-level contexts.
- `AdminKpiCard`, `AdminDataTable`, and `AdminFilterPill` implement high-level metrics, data presentation, and filtering affordances.

Design tokens draw from the Tailwind theme (dark background, white/blue accents) to match the control hub aesthetic. Extend cautiously and document new patterns here.
