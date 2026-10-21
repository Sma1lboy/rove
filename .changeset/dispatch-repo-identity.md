---
"@sma1lboy/rove": patch
---

Dispatching to another machine names the repo, not a path. `rove api add --machine mac --repo ~/code/rove` (a checkout on this machine) now finds the Mac's own checkout of the same repo, matched by the repo's root commit or else its `origin` URL, and creates the task there. A repo that machine has no checkout of is refused with `NO_REMOTE_CHECKOUT` and a hint to clone it there. A `--repo` that is not a checkout here is still taken as the target's own path. New verb `rove api repo-match --origin URL | --root SHA` answers which local checkout is a given repo.
