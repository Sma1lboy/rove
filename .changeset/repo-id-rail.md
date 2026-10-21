---
"@sma1lboy/rove": patch
---

The web app shows one project per repo across your machines. Tasks now carry a `repoId` (the repo's normalized `origin`, or its first commit when it has none), and the rail groups by it: `rove` on this machine and on `narwhal` is one header with a `narwhal` chip, every task underneath still running on its own machine. Two different repos with the same folder name read `me/rove` and `other/rove`.
