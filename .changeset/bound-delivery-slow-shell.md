---
"@sma1lboy/rove": patch
---

Stop the bound-delivery routine tests from failing, and leaking a spinning shell, on a machine with a slow login shell.

The precheck they start runs through an interactive login shell, which spends a second or two sourcing rc files before it reaches the command. vitest's default one-second `waitFor` expired first, so the test failed before writing the file its precheck spins on — leaving a shell forking `sleep` a hundred times a second with nothing left that would ever release it. The wait now allows for shell startup, and the release is written even when an assertion throws.
