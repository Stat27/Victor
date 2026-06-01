#!/usr/bin/env bash
set -euo pipefail

if command -v ollama >/dev/null 2>&1; then
  echo "Ollama already installed: $(ollama --version)"
  exit 0
fi

echo "Installing Ollama..."
curl -fsSL https://ollama.com/install.sh | sh

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl enable --now ollama
fi

ollama --version
