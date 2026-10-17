# Paperlane website

Source for the Paperlane product website (served by GitHub Pages from `docs/`).

- `commerce/` — storefront text (24 languages), legal pages and checkout configuration
- `scripts/build-sales.mjs` — regenerates the landing pages, legal pages, sitemap and robots file into `docs/`
- `docs/` — the published site, including the free in-browser demo at `/tool/`

Build: `node scripts/build-sales.mjs` (Node 20+). Documents opened in the demo are processed in the browser and are not uploaded.

Sold by Noonworks. Paperlane for Windows is sold through Lemon Squeezy.
