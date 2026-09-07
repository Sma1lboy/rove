# Filesystem path identity

`packages/kobe-daemon/src/path-identity.ts` owns lexical path identity for both
packages. Use `samePath` for equality, `pathWithin(parent, candidate)` for
containment, and `pathIdentity` for transient map/set keys. `pathWithin` returns
an empty suffix for the directory itself and `null` for an unrelated path.

The path syntax selects Windows or POSIX rules independently of the host OS.
Windows drive and UNC paths accept both separators. Drive letters, trailing
separators, and extended DOS/UNC prefixes normalize for comparison. Directory
component case remains significant because Windows directories can enable case
sensitivity. POSIX backslashes remain filename characters. SSH repository keys
remain opaque strings.

These functions do not resolve symlinks or touch the filesystem. Callers that
need physical identity, including worktree removal guards, keep their existing
realpath step before comparison. Guards compare whole directory segments:
`..cache` is a descendant name, while `../other` escapes to a sibling.

Keep presentation and input behavior separate. `pathSyntax` supplies basename
and separator rules; `path-home` owns home shortening; directory completion
preserves its trailing separator as an editing gesture. Git-relative file paths,
remote POSIX worktree paths, command argv, and snapshot equality retain their
own semantics.

Persisted worktree directory hashes and runtime socket names are storage and
transport identities, not transient comparison keys. Do not rewrite these with
the lexical helper: changing a hash can strand an existing worktree or PTY host.
An identity-format change requires a compatibility migration.

Run the candidate inventory from the repository root:

```sh
bun packages/kobe/scripts/audit-path-identity.ts
```

It emits source, line, and expression as TSV for review. A path-looking variable
is only a candidate: protocol strings and state-change comparisons also appear.
Regression tests in `test/lib/path-identity.test.ts`,
`test/lib/windows-path-consumers.test.ts`, and `test/state/repos-path-identity.test.ts`
exercise the shared rules and persisted-state consumers. Windows-specific tests
live outside the known-failing legacy file list so CI actually runs them.
