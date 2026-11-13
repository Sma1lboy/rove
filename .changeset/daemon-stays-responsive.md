---
"@sma1lboy/rove": patch
---

Rove keeps answering while it pushes a branch, opens a pull request, deletes a remote branch or sets up a workspace on another machine. Each of these used to freeze it until the network replied, which could make another machine think it had died.

A machine whose Rove is busy is no longer restarted from the other side. Before, a few seconds without an answer was enough to restart it, which ended its sessions and whatever it was doing. Now the machine shows as unreachable and the message says to restart it there if it stays that way.
