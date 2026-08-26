#!/bin/bash
# Reproducible recording script for the hello-events plugin demo.
# Produces docs/assets/plugins/hello-events.{cast,gif} when driven by:
#   PATH="$PWD/.scratch/tools/bin:$PATH" \
#   COLUMNS=80 LINES=24 \
#   asciinema rec -c packages/kobe-plugin-sdk/examples/hello-events/demo.tape \
#     --cols 80 --rows 24 docs/assets/plugins/hello-events.cast -q
#   agg --cols 80 --rows 24 --font-size 12 docs/assets/plugins/hello-events.cast \
#     docs/assets/plugins/hello-events.gif

cd packages/kobe

# Off-screen setup: link plugin, ensure repo exists, compute home, clear old events.
bun dev:sandbox --name ex-gif run plugin link ../kobe-plugin-sdk/examples/hello-events >/dev/null 2>&1
home=$(bun run scripts/dev-sandbox.ts --name ex-gif home)
mkdir -p "$home/smoke-repo"
git -C "$home/smoke-repo" init -q 2>/dev/null || true
rm -f "$home/.rove/plugins/examples.hello-events/state/events.jsonl"

PS1='$ '
delay=0.02

type_cmd() {
  echo -n "$ "
  local len=${#1}
  for ((i=0; i<len; i++)); do
    echo -n "${1:$i:1}"
    sleep $delay
  done
  echo
  sleep 0.2
}

run_cmd() {
  eval "$1"
  sleep 0.3
}

clear
type_cmd "bun dev:sandbox --name ex-gif run api issue-create --repo \"\$home/smoke-repo\" --title 'Demo issue'"
run_cmd "bun dev:sandbox --name ex-gif run api issue-create --repo \"$home/smoke-repo\" --title 'Demo issue'"

type_cmd "cat \"\$home/.rove/plugins/examples.hello-events/state/events.jsonl\""
run_cmd "cat \"$home/.rove/plugins/examples.hello-events/state/events.jsonl\""

sleep 1
