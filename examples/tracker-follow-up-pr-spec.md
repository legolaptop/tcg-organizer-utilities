# Tracker Follow-Up PR Spec

This document defines the next follow-up work after PR #14 was merged.

The goal is to keep the remaining work scoped, reviewable, and safe for parallel cloud-agent execution.

## Working Rules

- Branch from `main` for every follow-up PR.
- Keep each PR focused on one concern area.
- Do not introduce Scryfall bulk-data infrastructure in this phase.
- Keep the app static-first and GitHub-Pages-compatible.
- Treat uploaded local files as untrusted input.
- Avoid overlapping edits to the same hotspot files unless the work is intentionally serialized.

## Shared Product Direction

### Upload UX and wording

- Stop over-emphasizing `.mht` as if it is the only supported format.
- Prefer generic wording like `Load Orders from File`.
- Explain that users can save TCGPlayer order-history pages as `.mht`, `.mhtml`, or `.html`.
- Preferred UX direction: automatically process files after selection instead of requiring a second click.

### Safety and validation

- Keep all parsing client-side.
- Validate that uploaded files resemble expected TCGPlayer order-history content before parsing deeply.
- Avoid permissive raw HTML rendering.
- Restrict tracking/external link behavior to trusted/canonical URLs.

### Order totals and summaries

- Parse `Order Summary` fields directly where available.
- Treat summary `Total` as the canonical per-order total.
- Use canonical order totals for aggregate `Total Cost`.
- Show order summary values in the collapsible subheader with the order number.

### Scryfall strategy

- Keep live API fetching for now.
- Do not fetch Scryfall bulk card data in the browser.
- Improve cache reuse, deduplication, conservative concurrency, and 429 handling.
- Add exact-printing Scryfall links when enriched data exists.

## Recommended PR Split

### PR 1: Upload UX and Copy

Branch name:
`copilot/tracker-upload-ux-copy`

PR title:
`feat: improve tracker upload wording and file-pick UX`

Files in scope:
- `index.html`
- `public/index.html`
- `public/style.css`
- `public/tracker.js`

Primary goals:
- Replace MHT-specific wording with generic file wording.
- Add a small help affordance explaining how to save order-history pages.
- Prefer auto-processing immediately after file selection.
- If auto-processing is rejected, keep explicit action but redesign control layout.
- Clean up empty-state and hint text for consistency.

Acceptance criteria:
- Users can understand how to obtain a usable file without knowing what MHT means.
- Upload wording is consistent across tracker UI.
- Upload controls feel like a single coherent action path.

### PR 2: File Validation and Client-Side Safety

Branch name:
`copilot/tracker-file-validation-safety`

PR title:
`fix: harden local file parsing and tracking link safety`

Files in scope:
- `public/tracker.js`
- `public/app.js`

Primary goals:
- Add early validation for malformed or unsupported files.
- Keep parsing client-side with DOMParser/regex where appropriate.
- Remove remaining risky rendering patterns where practical.
- Tighten tracking/external-link generation to trusted behavior.

Acceptance criteria:
- Invalid files fail with clear feedback.
- Expected TCGPlayer files still parse.
- Tracking/external links are trusted/canonical only.

### PR 3: Order Summary Parsing and Canonical Totals

Branch name:
`copilot/tracker-order-summary-totals`

PR title:
`feat: parse order summary totals and show them in tracker details`

Files in scope:
- `public/tracker.js`
- `public/style.css`

Primary goals:
- Parse `quantity`, `subtotal`, `shipping`, `sales tax`, and `total` from each order summary.
- Treat summary `Total` as canonical.
- Use canonical totals in aggregate stats.
- Show order number plus summary values in the collapsible subheader.

Acceptance criteria:
- Order totals match visible TCGPlayer summary totals for representative orders.
- Aggregate `Total Cost` reflects those canonical totals.
- Subheader remains readable on desktop and mobile.

### PR 4: Scryfall Exact-Printing Links and Rate-Cap Hardening

Branch name:
`copilot/tracker-scryfall-links-rate-hardening`

PR title:
`feat: add exact-printing Scryfall links and harden live lookup usage`

Files in scope:
- `public/tracker.js`
- `public/app.js`

Primary goals:
- Link tracker card names to exact Scryfall printings when available.
- Strengthen deduplication and cache reuse across repeated actions.
- Use conservative concurrency.
- Add explicit 429/backoff/fallback behavior.

Acceptance criteria:
- Exact-printing links work when enrichment exists.
- Repeated exports/uploads avoid unnecessary refetches.
- Rate-limit behavior degrades gracefully.

## Parallel Execution Guidance

Recommended order:

1. Run PR 1 and PR 2 in parallel.
2. Merge or reconcile those results.
3. Run PR 3.
4. Run PR 4.

Why:

- PR 3 and PR 4 both want to edit `public/tracker.js` heavily.
- PR 1 and PR 2 have cleaner separation and less merge conflict risk.

## How To Use This With Cloud Agents

Cloud agents are effectively stateless from one run to the next.
They do not automatically share an internal plan with each other.

Best practice:

- Give each agent its own prompt.
- Reference this file explicitly in each prompt.
- Restrict each agent to its intended files and scope.

Suggested prompt prefix:

`Read examples/tracker-follow-up-pr-spec.md first and implement only the workstream assigned below.`
