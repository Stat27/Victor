#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd ollama
print_config

echo "Pulling model: $MODEL"
ollama pull "$MODEL"
