---
"@sma1lboy/rove": patch
---

Onboarding checks the machine before saying "ready". The first-run wizard gains a read-only "Environment check" page (the same git + engine probes `rove doctor` runs), and the closing banner only declares "You're ready to go!" when at least one engine is usable and git is present — otherwise it prints what is missing and how to fix it. A wizard killed mid-run also no longer loses the keyboard-basics page forever: a second launch re-runs once in primer mode (environment + keyboard pages, no re-asked questions).

Existing installs are unaffected by the new primer flag: a state file that already records a successful run is settled as done, so upgrading never produces a surprise wizard.
