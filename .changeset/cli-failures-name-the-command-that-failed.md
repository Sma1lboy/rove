---
"@sma1lboy/rove": patch
---

A failed subcommand is reported as itself, not as a failed launch.

Every uncaught subcommand error was prefixed `rove failed to start:`, which is
false for everything that started fine and then failed doing its job. Running
`rove adopt` outside a repository printed the raw git invocation with it:

```
rove failed to start: git worktree list --porcelain (cwd=/private/tmp) exited with code 128: fatal: not a git repository (or any of the parent directories): .git
```

It now names the command that failed and says what to do, matching the prefix
the subcommands that handle their own errors already print:

```
rove adopt: /private/tmp is not a git repository — run this inside one, or pass a repo path.
```

`KOBE_DEBUG=1` still prints the raw throw, argv and all, so bug reports lose
nothing. Unrecognized messages pass through verbatim rather than being
flattened into a guess.
