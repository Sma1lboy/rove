---
"@sma1lboy/rove": patch
---

`next` and `nightly` builds now report their own version. They used to print the previous stable version, which made `rove update --next` fail its install check after a successful install.
