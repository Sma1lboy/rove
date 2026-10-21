---
"@sma1lboy/rove": patch
---

Native Windows can now be a hub. Its OpenSSH cannot forward unix sockets, so Rove serves each machine's daemon and terminal sockets locally and relays every connection through `ssh <machine> rove daemon relay` over stdin and stdout. A Windows hub's machine rows no longer read `unsupported`, and `rove api … --machine`, `machine doctor` and the web all reach the other machine. New `rove daemon relay [--pty]` is that relay. Set `ROVE_MACHINE_TRANSPORT=stdio` to use the same transport on any hub whose target refuses socket forwarding.
