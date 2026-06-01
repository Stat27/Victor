#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd curl
print_config

EVAL_FILE="${1:-$ROOT_DIR/evals/general_chat.jsonl}"

if [[ ! -f "$EVAL_FILE" ]]; then
  echo "Eval file not found: $EVAL_FILE" >&2
  exit 1
fi

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  prompt="$(printf '%s' "$line" | sed -n 's/.*"prompt"[[:space:]]*:[[:space:]]*"\(.*\)".*/\1/p')"
  if [[ -z "$prompt" ]]; then
    echo "Skipping line without prompt: $line" >&2
    continue
  fi

  echo
  echo "Prompt: $prompt"
  curl -s "$OLLAMA_HOST/api/chat" \
    -H 'Content-Type: application/json' \
    -d "{
      \"model\": \"$VICTOR_NAME\",
      \"messages\": [
        {\"role\": \"user\", \"content\": \"$prompt\"}
      ],
      \"stream\": false
    }"
  echo
done <"$EVAL_FILE"
