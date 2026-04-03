# tcg-organizer-utilities

A web app to organize TCG collections by parsing TCGPlayer order history and tracking received cards.

## Features

- **Order Tracking**: Parse TCGPlayer order-history files (`.mht`, `.mhtml`, `.html`) and group orders by status
- **Card Inventory**: Mark orders as received and track individual cards within each order
- **CSV Export**: Export received cards to CSV for easy collection management
- **Smart Summaries**: View order totals, quantities, and per-card details at a glance
- **Refund Handling**: Automatically exclude refunded and missing cards from exports
- **Google Drive Integration**: Sync exported card data to Google Drive (optional)

## Local development

1. Install dependencies:
	npm install
2. Start the local server:
	npm start
3. Open:
	http://localhost:3000

## Web app file layout

The browser app is served from the `docs/` folder:

- `docs/index.html` — Main HTML entry point
- `docs/style.css` — Application styling
- `docs/app.js` — Google Drive sync and CSV conversion utilities
- `docs/tracker.js` — Order tracking UI and card management logic

Server code and parser/converter utilities remain outside `docs/`.

## GitHub Pages

The app is deployed to GitHub Pages with source set to `main` branch at root `/`.
A root-level `index.html` redirect ensures both root access and `/docs/` serving work correctly.

## How to use

1. Download your TCGPlayer order history as an MHT or HTML file
2. Click "Load Orders from File" and select your file
3. Review parsed orders grouped by estimated delivery date
4. Check the "Received" checkbox for orders you've received
5. Click "Export to CSV" for individual orders or "Export and Archive All Received Cards" for bulk export
6. Exported cards are added to your collection; bulk export also archives the included orders
