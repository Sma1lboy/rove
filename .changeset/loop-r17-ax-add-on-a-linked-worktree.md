---
"@sma1lboy/rove": patch
---

Stop `rove add <linked worktree>` from handing you the repository's primary checkout.

`discover-adoptable` excluded the main checkout by comparing each worktree to
the path the caller passed, so asking from a linked worktree excluded the
caller and left the user's own primary checkout in the adoptable list — where
`rove add` imported it, unprompted, as a disposable managed task on the default
branch. It now reads the primary checkout out of git's own listing; `adopt`
validates through the same list, so it refuses that path by name.

`rove add` also resolves a linked worktree to the repository before saving it,
the way `rove api add --repo` already did. The two entry points no longer mint
two project rows for one repo under two path spellings — which silently stopped
field notes routing between them, and gave one repository two managed-worktree
roots.

A remote project's key now carries its base path, so two repositories on one
host and user stay two projects instead of the second overwriting the first and
reporting it as an update. Projects registered under the older pathless key
keep it.

`collect --repo` and `digest --repo` no longer answer `{"tasks": []}` when a
repo path stops resolving: an unresolvable `--repo` is an error naming the
path, and task repos that will not resolve come back in `unresolvableRepos`.
