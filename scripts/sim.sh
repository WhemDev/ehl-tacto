#!/usr/bin/env bash
# Play against arena-sim on this machine: no key, no quota, no real suppliers.
# Loads every saved case file (starter-kit/cases: P01-P19, D01, D02) next to the sim's own S01-S03.
#
#   scripts/sim.sh play case:P01 --agent llm -v      # any arena command, pointed at the sim
#   scripts/sim.sh run --set practice --agent llm    # all cases in parallel
#   SIM_CLOCK=0 scripts/sim.sh play case:P05 -v      # without the 60-second rule
#   scripts/sim.sh stop
set -euo pipefail
KIT="$(cd "$(dirname "$0")/../starter-kit" && pwd)"
PORT="${SIM_PORT:-8000}"
export ARENA_URL="http://127.0.0.1:$PORT"
cd "$KIT"

if [[ "${1:-}" == "stop" ]]; then
  pkill -f "arena-sim serve.*--port $PORT" && echo "arena-sim stopped" || echo "arena-sim was not running"
  exit 0
fi

if ! curl -sf "$ARENA_URL/health" > /dev/null; then
  mkdir -p ../logs
  clock=(); [[ "${SIM_CLOCK:-1}" == "0" ]] && clock=(--no-clock)
  nohup uv run arena-sim serve --port "$PORT" --data data/package --cases cases ${clock[@]+"${clock[@]}"} \
    > ../logs/sim.log 2>&1 &
  for _ in $(seq 30); do curl -sf "$ARENA_URL/health" > /dev/null && break; sleep 0.5; done
  echo "arena-sim started on $ARENA_URL (log: logs/sim.log)"
fi

# A fresh simulator key per call: the sim's own quota never runs out, and the real key is never used.
ARENA_API_KEY="$(uv run arena register "sim-$(whoami)-$$" sim | python3 -c 'import json,sys; print(json.loads(sys.stdin.read().split("\n\n")[0])["api_key"])')"
export ARENA_API_KEY
[[ $# -gt 0 ]] && exec uv run arena "$@"
