#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE_PATH="${VICTOR_PROFILE:-profiles/laptop-8gb.env}"

if [[ "$PROFILE_PATH" != /* ]]; then
  PROFILE_PATH="$ROOT_DIR/$PROFILE_PATH"
fi

if [[ ! -f "$PROFILE_PATH" ]]; then
  echo "Profile not found: $PROFILE_PATH" >&2
  exit 1
fi

set -a
source "$PROFILE_PATH"
set +a

MODEL="${MODEL:?MODEL is required in the selected profile}"
VICTOR_NAME="${VICTOR_NAME:-victor}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
NUM_CTX="${NUM_CTX:-8192}"
THINK="${THINK:-false}"

case "$THINK" in
  true|false) ;;
  low|medium|high) ;;
  *)
    echo "THINK must be true, false, low, medium, or high; got: $THINK" >&2
    exit 1
    ;;
esac

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

print_config() {
  echo "Victor config:"
  echo "  profile: $PROFILE_PATH"
  echo "  model: $MODEL"
  echo "  victor name: $VICTOR_NAME"
  echo "  ollama host: $OLLAMA_HOST"
  echo "  num ctx: $NUM_CTX"
  echo "  think: $THINK"
}
