# First-run review evidence

Product reviews: #1171–#1177. Capture tooling: #1178.

Images are original 1280×800 PNGs, captured through browser → xterm.js → node-pty → real OpenTUI. Landing images use the actual landing DOM. All use an isolated HOME and disposable Git repository. The Codex process and hook payload are clearly labeled fixtures, not a real account/model. Theme: claude, dark, opaque; English. Landing keeps its existing light styling and animated demo, whose unrelated frame can vary.

Each `*-capture.json` records the exact product SHA and scenarios. Baseline is 4ccfb9c9a6a3484b49b3f9628b3c2ddf0d9785bf. Reviewed images come from run36832657346, except isolation after from run36833035832. The latter completed all six jobs successfully.

Onboarding dismissal JSON demonstrates retained queued choices, not successful installation. Recovery images show live reattachment and a new process after actual fixture PTY-host termination; they do not prove provider conversation resumption. Historical-only dead-process layout has component coverage but no screenshot here.

`dispatch/` retains the independently reproduced before/after traces for #1177. That regression uses real Git worktrees and public dispatch/hook handlers, but in-process transport and simulated provider child. Normalized before/after match; it is a preservation contract, not a claimed dispatch bug fix.
