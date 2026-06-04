#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

require_cmd curl
require_cmd jq
print_config

EVAL_FILE="${1:-$ROOT_DIR/evals/general_chat.jsonl}"
WRITE_RUN="${WRITE_RUN:-0}"
WRITE_RUN_DEBUG="${WRITE_RUN_DEBUG:-0}"

if [[ ! -f "$EVAL_FILE" ]]; then
  echo "Eval file not found: $EVAL_FILE" >&2
  exit 1
fi

relative_path() {
  local path="$1"
  if [[ "$path" == "$ROOT_DIR/"* ]]; then
    printf '%s\n' "${path#"$ROOT_DIR/"}"
  else
    printf '%s\n' "$path"
  fi
}

slugify() {
  printf '%s\n' "$1" | tr -cs '[:alnum:]._-' '-' | sed 's/^-//; s/-$//'
}

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

markdown_table_cell() {
  jq -Rr 'gsub("\\|"; "\\|") | gsub("\r?\n"; "<br>")'
}

profile_display="$(relative_path "$PROFILE_PATH")"
eval_display="$(relative_path "$EVAL_FILE")"
profile_slug="$(slugify "$(basename "$PROFILE_PATH" .env)")"
eval_slug="$(slugify "$(basename "$EVAL_FILE" .jsonl)")"
run_file=""
metrics_file=""
errors_file=""
raw_file=""

cleanup_benchmark_tmp() {
  [[ -n "${metrics_file:-}" ]] && rm -f "$metrics_file"
  [[ -n "${errors_file:-}" ]] && rm -f "$errors_file"
  [[ -n "${raw_file:-}" ]] && rm -f "$raw_file"
  return 0
}

if [[ "$WRITE_RUN" == "1" ]]; then
  mkdir -p "$ROOT_DIR/runs" "$ROOT_DIR/tmp"
  run_date="$(date +%F)"
  run_file="$ROOT_DIR/runs/$run_date-$profile_slug-$eval_slug.md"

  if [[ -e "$run_file" ]]; then
    suffix=2
    while [[ -e "$ROOT_DIR/runs/$run_date-$profile_slug-$eval_slug-$suffix.md" ]]; do
      suffix=$((suffix + 1))
    done
    run_file="$ROOT_DIR/runs/$run_date-$profile_slug-$eval_slug-$suffix.md"
  fi

  metrics_file="$(mktemp "$ROOT_DIR/tmp/benchmark-metrics.XXXXXX")"
  errors_file="$(mktemp "$ROOT_DIR/tmp/benchmark-errors.XXXXXX")"
  if [[ "$WRITE_RUN_DEBUG" == "1" ]]; then
    raw_file="$(mktemp "$ROOT_DIR/tmp/benchmark-raw.XXXXXX")"
  fi
  trap cleanup_benchmark_tmp EXIT
fi

total_prompts=0
total_eval_count=0
total_eval_duration=0
total_duration=0
failed_prompts=0

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
    error_message="$(printf '%s' "$response" | jq -r '.error')"
    echo "Error: $error_message" >&2
    failed_prompts=$((failed_prompts + 1))
    if [[ -n "$errors_file" ]]; then
      printf '%s\t%s\n' "$id" "$error_message" >>"$errors_file"
    fi
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

  if [[ -n "$metrics_file" ]]; then
    printf '%s\t%s\t%s\t%s\n' \
      "$id" \
      "$(ns_to_seconds "$total_duration_ns")" \
      "$eval_count" \
      "$generation_rate" >>"$metrics_file"
  fi

  if [[ -n "$raw_file" ]]; then
    printf '{"id":%s,"response":%s}\n' \
      "$(jq -Rn --arg id "$id" '$id')" \
      "$(printf '%s' "$response" | jq -c '.')" >>"$raw_file"
  fi

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

if [[ -n "$run_file" ]]; then
  overall_generation_rate="${overall_generation_rate:-0}"
  {
    echo "# Victor Benchmark Run"
    echo
    echo "- Date/time: $(date '+%Y-%m-%d %H:%M:%S %Z')"
    echo "- Profile: \`$profile_display\`"
    echo "- Model: \`$MODEL\`"
    echo "- Local alias: \`$VICTOR_NAME\`"
    echo "- Mode: \`$VICTOR_MODE\`"
    echo "- Think: \`$THINK\`"
    echo "- Eval file: \`$eval_display\`"
    echo
    echo "## Summary"
    echo
    echo "- Prompts completed: $total_prompts"
    echo "- Failed prompts: $failed_prompts"
    printf -- '- Total API duration: %.2fs\n' "$(ns_to_seconds "$total_duration")"
    echo "- Generated tokens: $total_eval_count"
    printf -- '- Average generation rate: %.2f tok/s\n' "$overall_generation_rate"
    echo
    echo "## Prompt Metrics"
    echo
    echo "| Prompt | Total duration | Generated tokens | Generation tok/s |"
    echo "| --- | ---: | ---: | ---: |"
    if [[ -s "$metrics_file" ]]; then
      while IFS=$'\t' read -r metric_id metric_duration metric_tokens metric_rate; do
        escaped_id="$(printf '%s' "$metric_id" | markdown_table_cell)"
        printf '| %s | %.2fs | %s | %.2f |\n' \
          "$escaped_id" \
          "$metric_duration" \
          "$metric_tokens" \
          "$metric_rate"
      done <"$metrics_file"
    fi
    echo
    if [[ -s "$errors_file" ]]; then
      echo "## Failed Prompts"
      echo
      echo "| Prompt | Error |"
      echo "| --- | --- |"
      while IFS=$'\t' read -r error_id error_message; do
        escaped_id="$(printf '%s' "$error_id" | markdown_table_cell)"
        escaped_error="$(printf '%s' "$error_message" | markdown_table_cell)"
        printf '| %s | %s |\n' "$escaped_id" "$escaped_error"
      done <"$errors_file"
      echo
    fi
    if [[ -s "$raw_file" ]]; then
      echo "## Raw JSON"
      echo
      echo '```jsonl'
      cat "$raw_file"
      echo '```'
      echo
    fi
    echo "## Human Quality Notes"
    echo
    echo "- "
  } >"$run_file"

  echo
  echo "Wrote run note: $(relative_path "$run_file")"
fi
