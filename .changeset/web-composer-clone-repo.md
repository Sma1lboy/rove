---
"@sma1lboy/rove": patch
---

The web New task project picker can now clone a repo that isn't on this machine yet: type a GitHub `owner/repo` or any git URL, pick "Clone", and Rove clones it with the machine's own git credentials into your clone folder (the same one the New task dialog uses), shows git's progress in the composer, and picks the new project; below your projects the picker also lists your own GitHub repositories (from `gh repo list`, skipped quietly when `gh` is missing or signed out), and a bare `owner/repo` clones over ssh when `gh` is set to ssh and https otherwise.
