#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd curl
print_config

curl "$OLLAMA_HOST/api/chat" \
  -H 'Content-Type: application/json' \
  -d "{
    \"model\": \"$VICTOR_NAME\",
    \"messages\": [
      {\"role\": \"user\", \"content\": \"Introduce yourself in one sentence.\"}
    ],
    \"stream\": false
  }"

echo
