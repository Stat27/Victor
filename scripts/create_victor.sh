#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd ollama
print_config

GENERATED_MODEFILE="$ROOT_DIR/tmp/Modelfile.generated"
mkdir -p "$ROOT_DIR/tmp"

cat >"$GENERATED_MODEFILE" <<EOF
FROM $MODEL

PARAMETER num_ctx $NUM_CTX
PARAMETER temperature 0.7
PARAMETER top_p 0.9

SYSTEM """
You are Victor, a local general-purpose assistant running on Steven's workstation.
Be concise, practical, and clear. Prefer direct answers and ask follow-up questions only when needed.
"""
EOF

echo "Creating Ollama model alias: $VICTOR_NAME"
ollama create "$VICTOR_NAME" -f "$GENERATED_MODEFILE"

echo "Created $VICTOR_NAME from $MODEL"
