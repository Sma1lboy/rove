---
"@sma1lboy/rove": patch
---

Refuse to run on a Bun older than `engines.bun` (1.3.11) instead of starting with silently dead terminals. Rove's terminal backend uses Bun's PTY spawn option, which an older Bun drops as an unknown option — no error, no output — and nothing was checking: `bun install` ignores `engines` outright and npm only honours it under `engine-strict`, so an old machine installed Rove cleanly, passed `rove doctor`, and then opened every terminal and engine tab empty. The launcher now skips a too-old Bun in favour of any newer one on the machine, and when there is none it names the binary, its version, and the upgrade command for whichever manager owns it (`ROVE_SKIP_BUN_CHECK=1` overrides, unsupported). `install.sh` checks the same floor before installing — upgrading a self-installed Bun in place, and refusing with instructions for a Bun it does not own — and `rove doctor` flags a below-floor Bun.
