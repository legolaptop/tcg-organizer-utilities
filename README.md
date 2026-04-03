# tcg-organizer-utilities

Utilities to help organize TCG collections.

## Local development

1. Install dependencies:
	npm install
2. Start the local server:
	npm start
3. Open:
	http://localhost:3000

## Web app file layout

The browser app is served from the `docs/` folder:

- `docs/index.html`
- `docs/style.css`
- `docs/app.js`
- `docs/tracker.js`

Server code and parser/converter utilities remain outside `docs/`.

## GitHub Pages

Use GitHub Pages with source set to `main` / `docs`.
That keeps a single static web root for both local server and Pages deployment.
