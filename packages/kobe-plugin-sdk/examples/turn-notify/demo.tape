#!/bin/bash
# Reproducible recording script for the turn-notify plugin demo.
# Produces docs/assets/plugins/turn-notify.{cast,gif} when driven by:
#   PATH="$PWD/.scratch/tools/bin:$PATH" \
#   COLUMNS=80 LINES=24 \
#   asciinema rec -c packages/kobe-plugin-sdk/examples/turn-notify/demo.tape \
#     --cols 80 --rows 24 docs/assets/plugins/turn-notify.cast -q
#   agg --cols 80 --rows 24 --font-size 12 docs/assets/plugins/turn-notify.cast \
#     docs/assets/plugins/turn-notify.gif

cd packages/kobe

# Off-screen setup: link plugin, ensure a repo/task exists, and reset the log.
bun dev:sandbox --name ex-gif run plugin link ../kobe-plugin-sdk/examples/turn-notify >/dev/null 2>&1
home=$(bun run scripts/dev-sandbox.ts --name ex-gif home 2>/dev/null)
mkdir -p "$home/smoke-repo"
git -C "$home/smoke-repo" init -q 2>/dev/null || true
bun dev:sandbox --name ex-gif run api issue-create --repo "$home/smoke-repo" --title warmup >/dev/null 2>&1
bun dev:sandbox --name ex-gif run add "$home/smoke-repo" >/dev/null 2>&1
task_id=$(bun dev:sandbox --name ex-gif run api list 2>/dev/null | bun -e 'const data = await Bun.stdin.json(); const task = data.tasks.find(t => t.repo.includes("smoke-repo")); console.log(task?.id ?? "")')
rm -f "$home/.rove/plugins/examples.turn-notify/log.jsonl"

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

# Expose the task id to the visible commands without typing the long id.
task=$task_id

clear
type_cmd "bun dev:sandbox --name ex-gif run api engine-report --kind turn-complete --task-id \"\$task\""
run_cmd "bun dev:sandbox --name ex-gif run api engine-report --kind turn-complete --task-id \"$task\""

type_cmd "bun dev:sandbox --name ex-gif run plugin log examples.turn-notify"
run_cmd "bun dev:sandbox --name ex-gif run plugin log examples.turn-notify"

sleep 1
