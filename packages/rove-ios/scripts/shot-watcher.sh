#!/bin/bash
# Screenshot handshake for the live UI test: for each <NN-name>.ready in $SHOT_DIR, take a real
# `simctl io booted screenshot` to <NN-name>.png, then touch <NN-name>.done.
# Usage: SHOT_DIR=docs/screenshots/ios [SIM=<udid>] scripts/shot-watcher.sh   (Ctrl-C / kill to stop)
# SIM picks the simulator when more than one is booted (default: booted).
set -u
DIR="${SHOT_DIR:?set SHOT_DIR}"
mkdir -p "$DIR"
while true; do
  for ready in "$DIR"/*.ready; do
    [ -e "$ready" ] || continue
    base="${ready%.ready}"
    [ -e "$base.done" ] && continue
    sleep 0.4   # let the UI settle
    xcrun simctl io "${SIM:-booted}" screenshot "$base.png" >/dev/null 2>&1
    touch "$base.done"
  done
  sleep 0.2
done
