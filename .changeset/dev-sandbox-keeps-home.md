---
"@sma1lboy/rove": patch
---

`dev:sandbox` no longer redirects `HOME`. Only Rove's own state is thrown away; engines under test see the same credentials, accounts, and vendor set as production instead of looking logged-out.
