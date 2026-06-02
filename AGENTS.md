# Agent Instructions

## Project Goal

Victor is a reproducible local model deployment and iteration repo.

The repo should help user:

- run a local Ollama model named `victor`;
- compare model/profile choices on the same machine;
- tune Victor for user's actual workstation and engineering workflow;
- record clean benchmark and quality results over time;
- reproduce the setup on other machines without committing model weights.

Do not treat this as only an Ollama install repo. The higher-level goal is to build a local assistant iteration process.

## Current Baseline

- Runtime: Ollama.
- Default model profile: `profiles/laptop-8gb.env`.
- Default model: `qwen3.5:9b`.
- Daily-chat setting: `THINK=false`.
- Reasoning comparison profile: `profiles/laptop-8gb-thinking.env`.
- Main benchmark script: `scripts/benchmark.sh`.
- First run note: `runs/2026-06-01-qwen3.5-9b.md`.

user handles final `git add`, `git commit`, and `git push` unless explicitly asking the agent to do it.

## Working Rules

- Do not commit or push unless user explicitly asks.
- Do not download models unless user explicitly asks.
- Do not overwrite run notes or user-entered benchmark results without asking.
- Prefer small, focused changes that improve the iteration loop.
- Keep scripts portable Bash where practical.
- Use `jq` for JSON parsing instead of ad hoc text parsing.
- Keep model blobs, logs, temporary generated files, and private prompts out of Git.
- If changing benchmark behavior, update `README.md` and this file when needed.

## Current Issues To Address

- Benchmark results are still copied into run notes manually.
- Run notes can become messy because raw terminal output is pasted into Markdown.
- There are no Victor behavior modes yet, only one generic `Modelfile`.
- Evals are still generic and do not fully represent user's real workflow.
- GPU/performance diagnostics are manual.
- Model comparison requires running profile commands by hand.

## Planned Work

### 1. Automatic Run Logging

Upgrade `scripts/benchmark.sh` so it can write structured results automatically.

Target behavior:

```bash
./scripts/benchmark.sh evals/general_chat.jsonl
```

should still print to the terminal, but also support:

```bash
WRITE_RUN=1 ./scripts/benchmark.sh evals/general_chat.jsonl
```

Expected output file:

```text
runs/YYYY-MM-DD-<profile>-<eval>.md
```

The generated run file should include:

- date/time;
- profile path;
- model;
- local alias;
- think setting;
- eval file;
- per-prompt total duration;
- per-prompt generated token count;
- per-prompt generation tokens/sec;
- summary average generation tokens/sec;
- placeholder for human quality notes.

Keep raw JSON out of the default Markdown output unless a debug flag is enabled.

### 2. Victor Modes

Add mode-specific prompt files so Victor can be tuned for user's actual use.

Proposed structure:

```text
modes/
  daily.Modelfile
  debug.Modelfile
  reasoning.Modelfile
  code-review.Modelfile
  deployment.Modelfile
```

Update `scripts/create_victor.sh` to support:

```bash
VICTOR_MODE=daily ./scripts/create_victor.sh
```

Default mode should be `daily`.

Mode intent:

- `daily`: concise local assistant, practical answers, no unnecessary reasoning.
- `debug`: step-by-step diagnostics for Linux, NVIDIA, Ollama, Docker, Git.
- `reasoning`: deeper analysis, suitable with `THINK=true`.
- `code-review`: findings first, bugs/risks/tests prioritized.
- `deployment`: commands, verification, rollback, reproducibility.

### 3. User-Specific Evals

Add eval sets that measure usefulness for user's actual work.

Proposed files:

```text
evals/user_workstation.jsonl
evals/local_model_deploy.jsonl
evals/linux_gpu_debug.jsonl
evals/git_workflow.jsonl
```

The prompts should test:

- explaining `nvidia-smi` output;
- diagnosing slow Ollama generation;
- comparing local models under an 8 GB VRAM constraint;
- fixing common Git/GitHub push errors;
- designing reproducible local deployment steps;
- keeping answers concise and command-oriented.

### 4. Model Comparison Workflow

Add profiles for the main candidates:

```text
profiles/qwen3.5-9b.env
profiles/qwen3.5-4b.env
profiles/hermes3-8b.env
profiles/deepseek-r1-8b.env
```

Then add:

```text
scripts/compare_models.sh
```

Target usage:

```bash
./scripts/compare_models.sh evals/user_workstation.jsonl
```

The comparison should run selected profiles, call `create_victor.sh`, run the benchmark, and produce a compact comparison table.

Do not make the script pull models automatically by default. Pulling should stay explicit unless user opts in.

### 5. GPU Diagnostics

Add:

```text
scripts/gpu_snapshot.sh
```

It should capture:

- `nvidia-smi`;
- `prime-select query` when available;
- current Ollama process GPU memory;
- total GPU memory used;
- driver/CUDA version;
- timestamp.

Use this before and during benchmark runs to explain slow results.

## Acceptance Criteria For The Next Milestone

The next milestone is complete when:

- a benchmark run can create a clean run note automatically;
- Victor can be created in at least `daily` and `debug` modes;
- there is at least one user-specific eval file;
- `README.md` documents the new workflow;
- all changed shell scripts pass `bash -n`;
- no model blobs or private logs are tracked by Git.
