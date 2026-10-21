---
"@sma1lboy/rove": patch
---

New `rove machine tunnel <alias> --install` keeps a reverse SSH tunnel to a registered machine, so that machine can reach this one even when it cannot dial it directly, such as a WSL distro behind Windows NAT. The tunnel runs as a systemd user service on Linux or a launchd agent on macOS: it restarts when the link drops and comes back at login. Without `--install` it prints the ssh command and service file; `--uninstall` removes it. Then register this machine on the other side with `rove machine add <you>@127.0.0.1:2222`.
