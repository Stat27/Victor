# Victor

Victor is a local model deployment workflow for running and iterating on an Ollama-hosted assistant.

The goal is not to commit model weights. The repo captures the repeatable process: pick a model, create a local Ollama alias, test it, benchmark it, record the result, and improve the next iteration.

## Default Setup

- Runtime: Ollama
- Local model name: `victor`
- Default base model: `qwen3.5:9b`
- Default profile: `profiles/laptop-8gb.env`
- Target machine: Linux laptop/workstation with NVIDIA GPU and about 8 GB VRAM

## Repository Layout

```text
apps/
  desktop/
    frontend/      Native desktop UI assets loaded by Tauri
    src-tauri/     Rust/Tauri shell and native commands
packages/
  agent/
    src/           TypeScript agent, web router, chat core, and Ollama helpers
docs/
  plans/           Long-form planning and roadmap documents
memory/            Durable prompt-injected memory
profiles/          Runtime/model profiles
modes/             Victor behavior mode Modelfiles
evals/             Benchmark/evaluation prompt sets
runs/              Recorded benchmark and model run notes
scripts/           Setup, model creation, test, and benchmark scripts
```

## Quick Start

Install Ollama:

```bash
./scripts/install_ollama.sh
```

Pull the configured model:

```bash
./scripts/pull_model.sh
```

Create the `victor` model alias:

```bash
./scripts/create_victor.sh
```

Create Victor with a specific behavior mode:

```bash
VICTOR_MODE=debug ./scripts/create_victor.sh
```

Test the local API:

```bash
./scripts/test_api.sh
```

Run a small benchmark prompt set:

```bash
./scripts/benchmark.sh
```

The benchmark prints each answer plus Ollama timing metrics, including total duration, prompt evaluation speed, generated token count, and generation tokens per second.

Write a clean Markdown run note while still printing the benchmark to the terminal:

```bash
WRITE_RUN=1 ./scripts/benchmark.sh evals/general_chat.jsonl
```

Run notes are written to:

```text
runs/YYYY-MM-DD-<profile>-<eval>.md
```

If a same-day run note already exists, the script writes a numbered file instead of overwriting it. The default run note includes configuration, per-prompt timing and generation metrics, summary tokens/sec, and a placeholder for human quality notes. Set `WRITE_RUN_DEBUG=1` with `WRITE_RUN=1` only when you also want raw Ollama JSON included in the Markdown.

By default, the laptop profile sends `think: false` to Ollama so daily-chat benchmarks measure final-answer speed instead of hidden reasoning traces. To benchmark thinking mode for reasoning tasks:

```bash
VICTOR_PROFILE=profiles/laptop-8gb-thinking.env ./scripts/benchmark.sh evals/reasoning.jsonl
```

## Web Access

Victor does not browse by itself. The TypeScript web wrapper searches the web, fetches readable source excerpts, and passes those sources to the local Ollama model with citation instructions.

Ask a web-backed question:

```bash
npm run web -- "latest Ollama tool calling docs"
```

Ask Victor to decide whether web search is needed:

```bash
npm run agent -- "how do I recreate victor in debug mode?"
```

`npm run web` always searches. `npm run agent` first asks Victor whether current web information is needed; if yes, Victor proposes the search query and the wrapper fetches sources before answering.

Start an interactive chat session:

```bash
npm run chat
```

Start the native Tauri desktop app:

```bash
npm run desktop
```

The desktop script clears Snap-provided GTK/GIO locale variables before launch. This avoids WebKitGTK loading incompatible `/snap/core20` libraries when running from a Snap-packaged VS Code terminal. Use `npm run desktop:raw` only when you want the unmodified Tauri dev command.

Chat commands:

- `/help`: show commands.
- `/memory`: show loaded memory.
- `/remember <note>`: append a user-written note to `memory/facts.md`.
- `/propose-memory`: ask Victor to propose one memory update from the session.
- `/approve`: save the pending proposed memory update.
- `/reject`: discard the pending proposed memory update.
- `/clear`: clear session history.
- `/exit`: exit chat.

For model and hardware questions, the agent adds source-targeted fallback searches and tries to avoid stale year-specific queries unless the user asks for a specific year.

When the user asks for a take or recommendation, Victor should ground facts first and then include a clearly labeled practical take.

Useful environment variables:

- `OLLAMA_HOST`: local Ollama API URL, default `http://localhost:11434`.
- `VICTOR_NAME`: local model alias, default `victor`.
- `THINK`: request thinking setting, default `false`.
- `WRITE_RUN`: set to `1` to write a structured benchmark run note.
- `WRITE_RUN_DEBUG`: set to `1` with `WRITE_RUN=1` to include raw Ollama JSON in the run note.
- `WEB_MAX_RESULTS`: search results to fetch, default `5`.
- `WEB_MAX_CHARS`: source excerpt size, default `1800`.
- `VICTOR_MEMORY_DIR`: memory directory, default `memory`.

## Memory

Victor wrappers inject lightweight local memory into agent/web prompts:

- `memory/machine.md`: hardware and environment facts.
- `memory/preferences.md`: workflow and behavior preferences.
- `memory/projects.md`: active project goals, state, and decisions.
- `memory/benchmarks.md`: local benchmark observations.
- `memory/facts.md`: approved durable notes.

This is prompt-injected memory, not model training. Edit these files when the machine, preferences, or benchmark baseline changes.

## Profiles

The scripts read `VICTOR_PROFILE`, defaulting to:

```bash
profiles/laptop-8gb.env
```

Use another profile like this:

```bash
VICTOR_PROFILE=profiles/low-vram.env ./scripts/create_victor.sh
```

Candidate profiles:

- `profiles/qwen3.5-9b.env`: default quality/practicality balance.
- `profiles/qwen3.5-4b.env`: faster fallback.
- `profiles/hermes3-8b.env`: persona and agent-style behavior candidate.
- `profiles/deepseek-r1-8b.env`: reasoning comparison candidate.

Profiles define:

- `MODEL`: Ollama base model tag.
- `VICTOR_NAME`: local Ollama model alias.
- `OLLAMA_HOST`: local Ollama API base URL.
- `NUM_CTX`: requested context window for the generated `Modelfile`.
- `THINK`: request-level thinking setting sent to Ollama, usually `false` for daily chat or `true` for reasoning tests.

## Victor Modes

The scripts read `VICTOR_MODE`, defaulting to:

```bash
daily
```

Available modes:

- `daily`: concise local workstation assistant.
- `debug`: Linux, NVIDIA, Ollama, Git, Docker, and deployment diagnostics.
- `reasoning`: deeper engineering tradeoff analysis.
- `code-review`: findings-first review mode.
- `deployment`: reproducible setup, verification, rollback, and portability.

Create a mode-specific Victor alias like this:

```bash
VICTOR_MODE=deployment ./scripts/create_victor.sh
```

## Iteration Loop

1. Pick a model profile.
2. Pull the model with `scripts/pull_model.sh`.
3. Pick a Victor mode and create or recreate Victor with `scripts/create_victor.sh`.
4. Run `scripts/test_api.sh`.
5. Run `WRITE_RUN=1 ./scripts/benchmark.sh <eval-file>` and compare generation tokens/sec.
6. Add human quality observations to the generated note in `runs/`.
7. Promote the best profile and `Modelfile` settings.

## Portability

To reproduce Victor on another machine:

```bash
git clone <repo-url>
cd victor
./scripts/install_ollama.sh
./scripts/pull_model.sh
./scripts/create_victor.sh
./scripts/test_api.sh
```

Adjust `VICTOR_PROFILE` if the target GPU has less or more VRAM.

## Do Not Commit

- Ollama model blobs
- `.ollama/`
- private prompts
- large benchmark logs
- API keys or credentials
- system driver configuration

See `docs/plans/LOCAL_MODEL_DEPLOY_PLAN.md` for the planning notes and model ranking.
See `docs/plans/PERSONAL_AGENT_PLAN.md` for the personal-agent roadmap.
