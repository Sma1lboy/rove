---
"@sma1lboy/rove": patch
---

`rove machine add` now fixes what it can instead of stopping at the first error. Run in a terminal, it shows the exact command for each fix, asks, runs it and tries again. If the machine accepts none of your keys, it creates a key just for this Rove (`~/.rove/ssh/hub_ed25519`) and adds it to that machine's `authorized_keys`, asking for that machine's password once, through ssh. If Rove is missing there, it runs the official install script; if Rove is too old, it runs `rove update`. `--yes` accepts every fix without asking, and without a terminal the plan is printed and nothing runs. New `rove machine doctor [alias]` re-checks registered machines, offers the same fixes, flags a Rove version different from this one, and exits 1 when a machine is unusable.
