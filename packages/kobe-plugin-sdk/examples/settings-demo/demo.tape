#!/bin/bash
# Reproducible recording script for the settings-demo plugin demo.
# Produces docs/assets/plugins/settings-demo.{cast,gif} when driven by:
#   PATH="$PWD/.scratch/tools/bin:$PATH" \
#   COLUMNS=80 LINES=24 \
#   asciinema rec -c packages/kobe-plugin-sdk/examples/settings-demo/demo.tape \
#     --cols 80 --rows 24 docs/assets/plugins/settings-demo.cast -q
#   agg --cols 80 --rows 24 --font-size 12 docs/assets/plugins/settings-demo.cast \
#     docs/assets/plugins/settings-demo.gif

cd packages/kobe

# Off-screen setup: link plugin, compute home, write custom settings.
bun dev:sandbox --name ex-gif run plugin link ../kobe-plugin-sdk/examples/settings-demo >/dev/null 2>&1
home=$(bun run scripts/dev-sandbox.ts --name ex-gif home)
mkdir -p "$home/.rove/plugins/examples.settings-demo/config"
cat > "$home/.rove/plugins/examples.settings-demo/config/.env" <<'ENV'
EX_DEMO_NAME=Demo
EX_DEMO_THEME=dark
EX_DEMO_NOTIFY=0
ENV

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
type_cmd "bun dev:sandbox --name ex-gif run plugin action invoke examples.settings-demo.print"
run_cmd "bun dev:sandbox --name ex-gif run plugin action invoke examples.settings-demo.print"

sleep 1
