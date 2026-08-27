---
"@sma1lboy/rove": patch
---

Landing page performance and accessibility pass. First load drops from 625 KB / 11 requests to 148 KB / 10 requests: the final-band background is now a lazy-loaded WebP (478 KB PNG → 40 KB, fetched only when scrolled into view) and scripts moved to `<head>` with `defer`. Accessibility: warm accent, faint, ok and warn tokens darkened at the lightness axis only so small text and white-on-accent buttons clear WCAG AA 4.5:1 (hue/chroma — the brand — untouched); the navbar links gained a `<nav>` landmark on all four pages; the fleet mock's Inbox overlay is a proper `role="dialog"`; the copy-install button announces "copied" via `aria-live`; the language toggle tags its label with `lang`.
