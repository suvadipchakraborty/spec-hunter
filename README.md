# SpecHunter

Reverse-engineer your next car purchase. Search by power, weight, and layout, not by the badge.

Zero-build PWA: plain HTML, CSS, and ES6+ JavaScript. Data from [CarAPI](https://carapi.app).

## Files

```text
├── index.html      App shell, filters, tabs, Open Graph tags
├── styles.css      Dark garage/blueprint theme
├── app.js          Config, spec engine, rendering, share, PWA install
├── manifest.json   PWA manifest (inline SVG icon)
├── sw.js           Service worker (app shell cache)
└── README.md
```

## Setup

1. `CONFIG` in `app.js` holds `CARAPI_API_TOKEN` and `CARAPI_API_SECRET`. The app exchanges them for a JWT via `/api/auth/login`, caches it, and refreshes it when it expires. (Optionally paste a ready-made JWT into `CARAPI_JWT_TOKEN` to skip the login.)
2. Add a `preview.png` (1200x630) next to `index.html`. It is the `og:image` for link previews.
3. Push to GitHub and connect the repo to Cloudflare Pages (no build command, output directory `/`).

## How the search works

1. **Engines** (`/api/engines`) are filtered by drive type, minimum horsepower, and cylinders, walking every page up to `MAX_PAGES`.
2. **Bodies** (`/api/bodies`) are filtered by maximum curb weight when the weight cap is set.
3. The two result sets are intersected on `make_model_trim_id`, sorted by horsepower.
4. **Trims** (`/api/trims`) are resolved in batches of 50 ids, filtered by model year, and rendered 24 cards at a time ("Show more trims").

## Notes

- **Credential exposure:** the API token and secret in `app.js` are readable by anyone who views the site or the GitHub repo. Use a private repo at minimum, and rotate the secret if it ever leaks. For a public site, put a small Cloudflare Worker in front of CarAPI that adds the token server-side, then point `CONFIG.API_BASE` at it.
- **Plan limits:** CarAPI's free tier limits the model years it returns. Results outside your plan simply will not appear.
- **Field names:** the filters use CarAPI's `drive_type`, `horsepower_hp`, `cylinders`, `curb_weight`, and `make_model_trim_id` fields. If CarAPI changes a field name or value format, adjust `DRIVE_VALUES`, `cylVariants()`, and the filter arrays in `hunt()`.
- **Images:** card photos use the Wikipedia page summary for "Make Model" and fall back to a CSS-friendly SVG silhouette. Lookups are cached in `localStorage`.
- **Icons:** the manifest uses an inline SVG icon. For the most reliable install prompt on every browser, add `icon-192.png` and `icon-512.png` and list them in `manifest.json`.
- **Updating:** bump `CACHE` in `sw.js` whenever you ship changes so installed apps refresh.
