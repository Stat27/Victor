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
EOF

cat "$MODEFILE_PATH" >>"$GENERATED_MODEFILE"

echo "Creating Ollama model alias: $VICTOR_NAME"
ollama create "$VICTOR_NAME" -f "$GENERATED_MODEFILE"

echo "Created $VICTOR_NAME from $MODEL using mode: $VICTOR_MODE"
