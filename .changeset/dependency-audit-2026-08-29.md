---
"@sma1lboy/rove": patch
---

Refresh monorepo dependencies to clear audit advisories that have safe fixes.

- `@sma1lboy/kobe-docs`: `next` 16.2.12 → 16.3.3 (pulls `sharp` 0.35.4 and resolves GHSA-f88m-g3jw-g9cj); `fumadocs-core`, `fumadocs-mdx`, `fumadocs-ui` to latest compatible minors.
- `kobe-web`: `vite` 8.1.4 → 8.2.2; `vitest` 4.1.10 → 4.1.11.

21 advisories remain because they require upstream releases or major-version bumps; see PR description for the full before/after comparison.
