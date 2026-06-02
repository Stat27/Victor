#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd curl
require_cmd jq
print_config

EVAL_FILE="${1:-$ROOT_DIR/evals/general_chat.jsonl}"

if [[ ! -f "$EVAL_FILE" ]]; then
  echo "Eval file not found: $EVAL_FILE" >&2
  exit 1
fi

ns_to_seconds() {
  jq -nr --argjson ns "${1:-0}" '($ns / 1000000000) | tostring'
}

rate_per_second() {
  local count="${1:-0}"
  local ns="${2:-0}"
  jq -nr --argjson count "$count" --argjson ns "$ns" '
    if $ns > 0 then
      (($count * 1000000000) / $ns)
    else
      0
    end
  '
}

total_prompts=0
total_eval_count=0
total_eval_duration=0
total_duration=0

while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  prompt="$(printf '%s' "$line" | jq -r '.prompt // empty')"
  id="$(printf '%s' "$line" | jq -r '.id // "prompt"')"
  if [[ -z "$prompt" ]]; then
    echo "Skipping line without prompt: $line" >&2
    continue
  fi

  echo
  echo "== $id =="
  echo "Prompt: $prompt"

  response="$(jq -n \
    --arg model "$VICTOR_NAME" \
    --arg prompt "$prompt" \
    --arg think "$THINK" \
    '{
      model: $model,
      messages: [
        {role: "user", content: $prompt}
      ],
      think: (if $think == "true" then true elif $think == "false" then false else $think end),
      stream: false
    }' | curl -s "$OLLAMA_HOST/api/chat" \
    -H 'Content-Type: application/json' \
    -d @-)"

  if printf '%s' "$response" | jq -e '.error?' >/dev/null; then
    echo "Error: $(printf '%s' "$response" | jq -r '.error')" >&2
    continue
  fi

  answer="$(printf '%s' "$response" | jq -r '.message.content // ""')"
  total_duration_ns="$(printf '%s' "$response" | jq -r '.total_duration // 0')"
  load_duration_ns="$(printf '%s' "$response" | jq -r '.load_duration // 0')"
  prompt_eval_count="$(printf '%s' "$response" | jq -r '.prompt_eval_count // 0')"
  prompt_eval_duration_ns="$(printf '%s' "$response" | jq -r '.prompt_eval_duration // 0')"
  eval_count="$(printf '%s' "$response" | jq -r '.eval_count // 0')"
  eval_duration_ns="$(printf '%s' "$response" | jq -r '.eval_duration // 0')"

  prompt_rate="$(rate_per_second "$prompt_eval_count" "$prompt_eval_duration_ns")"
  generation_rate="$(rate_per_second "$eval_count" "$eval_duration_ns")"

  echo
  echo "Answer:"
  echo "$answer"
  echo
  printf 'Total duration: %.2fs\n' "$(ns_to_seconds "$total_duration_ns")"
  printf 'Load duration: %.2fs\n' "$(ns_to_seconds "$load_duration_ns")"
  printf 'Prompt eval: %s tokens at %.2f tok/s\n' "$prompt_eval_count" "$prompt_rate"
  printf 'Generation: %s tokens at %.2f tok/s\n' "$eval_count" "$generation_rate"

  total_prompts=$((total_prompts + 1))
  total_eval_count=$((total_eval_count + eval_count))
  total_eval_duration=$((total_eval_duration + eval_duration_ns))
  total_duration=$((total_duration + total_duration_ns))
done <"$EVAL_FILE"

if [[ "$total_prompts" -gt 0 ]]; then
  overall_generation_rate="$(rate_per_second "$total_eval_count" "$total_eval_duration")"
  echo
  echo "== Summary =="
  echo "Prompts completed: $total_prompts"
  printf 'Total wall/API duration: %.2fs\n' "$(ns_to_seconds "$total_duration")"
  echo "Generated tokens: $total_eval_count"
  printf 'Average generation rate: %.2f tok/s\n' "$overall_generation_rate"
fi
