# Tracker Implementation Status

This document tracks completed and pending work on the order tracker feature.

## Completed Work

### ✅ PR #23: UI Polish and Order Card Refinements
**Branch:** `feature/ui-refinements`  
**Status:** Merged

**What was delivered:**
- Removed Details button; replaced with click-to-expand on order headers
- Renamed "Exported" terminology to "Archived" throughout the UI
- Added per-order "Export to CSV" button in order subheader (inline with order ID)
- Redesigned order summary display:
  - Moved from header to expanded-body footer
  - Qty displayed as single-line label on left
  - Order totals (qty, subtotal, shipping, tax) stacked on right with right alignment
  - Used `font-variant-numeric: tabular-nums` for numeric column alignment
- Clarified export behavior in help text:
  - Per-order "Export to CSV" adds cards without archiving
  - Global "Export and Archive All Received Cards" archives the included orders
- Updated help text from "canceled" to "refunded" for consistency

**Files modified:**
- `docs/tracker.js`
- `docs/style.css`
- `docs/index.html`

**Test status:** 220/220 passing

---

### ✅ PR #24: Structural Migration – Consolidated Web Root
**Branch:** `feature/consolidate-web-root`  
**Status:** Merged

**What was delivered:**
- Consolidated root-level and `public/` app files into a single `docs/` folder
- Removed duplication risk by maintaining one canonical source:
  - Moved `index.html`, `app.js`, `style.css`, `tracker.js` to `docs/`
  - Deleted `public/` folder entirely
- Updated `server.js` to serve static assets from `docs/`
- Updated `README.md` to document the file layout
- Updated example documentation to reference `docs/` paths

**Rationale:**
- Single source of truth for web app files
- Cleaner GitHub Pages compatibility (Pages serves from `docs/` by default)
- Reduces maintenance burden and file-drift risk

**Test status:** 220/220 passing

---

### ✅ GitHub Pages Recovery
**Branch:** `hotfix/pages-redirect`  
**Status:** Merged

**What was delivered:**
- Created root-level `index.html` with HTTP redirect to `./docs/`
- Reconfigured GitHub Pages source back to `main` / (root)
- This ensures both direct-root and `/docs/` paths work correctly in Pages environment
- Confirmed via health checks that root URL returns 200 OK

**Why this was needed:**
- Initial Pages config (main/docs) caused edge caching issues
- Root redirect provides a reliable, cacheless entrypoint

**Test status:** GitHub Pages deployment verified

---

## Architecture and Current State

### Order Tracking UI Pattern

**Header (Click-to-Expand):**
- Receiver checkbox on left
- Seller name and order date in center
- Order status badges (unshipped, overdue, refund) on right
- Cursor: pointer to indicate clickability

**Subheader (Always Visible):**
- Order ID on left
- "Export to CSV" button on right

**Body (Expanded Content):**
- Order ID and tracking details
- Card list with per-card details (name, set, condition, qty, price)
- Order summary at bottom with qty on left, totals on right
- Refund banner if applicable

### Export Behavior

| Action | Archives | Exports |
|--------|----------|---------|
| Per-order "Export to CSV" | ❌ No | ✅ Single order only |
| Global "Export and Archive All" | ✅ Yes | ✅ All received orders |
| Google Drive sync | ❌ No | ✅ CSV data | Archived checkbox | ❌ Always visible but archived orders can still export |

### Styling Highlights

- Order cards: `display: flex` for layout, `cursor: pointer` on header
- Summary numbers: `font-variant-numeric: tabular-nums` for alignment
- Summary total rows: `font-weight: 800` with darker color (#1a202c)
- Card prices: `min-width: 11.5rem` to align with summary totals above

---

## Pending / Future Work

### Backlog for Consideration

1. **Scryfall Exact-Printing Links** (low priority)
   - Add hyperlinks from card names to exact Scryfall editions when enrichment data exists
   - Improve live API caching and deduplication
   - Add explicit rate-limit (429) handling with backoff

2. **In-App Feature Announcements**
   - Add a "What's New" panel for future feature announcements
   - Help users discover UI improvements without external communication

3. **Upload UX Refinements**
   - Generic file-input wording that doesn't emphasize `.mht` format
   - Consider auto-processing files immediately on selection (no separate action button)

4. **Advanced Safety Hardening**
   - Validate uploaded files match expected TCGPlayer order-history structure
   - Restrict external link generation to trusted domains only

---

## Test Coverage

All changes are covered by existing Jest test suite:
- **orderParser.test.js** — Validates order and card object structure
- **parser.test.js** — MHT/HTML parsing and card extraction
- **csvFormatter.test.js** — CSV export formatting
- **htmlParser.test.js** — TCGPlayer-specific HTML parsing
- **cardValidator.test.js** — Card field validation
- **setConverter.test.js** — Magic set name normalization

**Current status:** 220/220 tests passing

---

## Deployment Notes

- **Local dev**: `npm start` runs Express server on port 3000, serves from `docs/`
- **GitHub Pages**: Configured to main branch root, uses redirect from root `index.html` to `./docs/`
- **File sync**: Server code (`server.js`), parser utilities (`src/`), and tests (`test/`) remain outside the web root
- **Build process**: No build step required; app runs as-is in browser

---

## Summary

The order tracker feature is functionally complete with polished UI, clear export semantics, and stable file structure. All core requirements from initial feature spec are implemented and tested. Future work is primarily refinement and advanced integrations (Scryfall links, rate limiting).
