---
"@sma1lboy/rove": patch
---

`rove update` can install a version that was published moments ago.

bun caches the package manifest, so a just-released version came back as `No version matching "0.9.62" found for specifier "@sma1lboy/rove" (but package exists)` — a message that names neither the cache nor a way out, and reads as if the release were broken. The install now asks bun to re-fetch the manifest, and if a stale cache ever surfaces anyway, the error says so and gives the command that clears it.
