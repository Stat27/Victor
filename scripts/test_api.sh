#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd curl
require_cmd jq
print_config

jq -n \
  --arg model "$VICTOR_NAME" \
  --arg think "$THINK" \
  '{
    model: $model,
    messages: [
      {role: "user", content: "Introduce yourself in one sentence."}
    ],
    think: (if $think == "true" then true elif $think == "false" then false else $think end),
    stream: false
  }' | curl "$OLLAMA_HOST/api/chat" \
  -H 'Content-Type: application/json' \
  -d @-

echo
