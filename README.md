# Victor

Victor is a local model deployment workflow for running and iterating on an Ollama-hosted assistant.

The goal is not to commit model weights. The repo captures the repeatable process: pick a model, create a local Ollama alias, test it, benchmark it, record the result, and improve the next iteration.

## Default Setup

- Runtime: Ollama
- Local model name: `victor`
- Default base model: `qwen3.5:9b`
- Default profile: `profiles/laptop-8gb.env`
- Target machine: Linux laptop/workstation with NVIDIA GPU and about 8 GB VRAM

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

By default, the laptop profile sends `think: false` to Ollama so daily-chat benchmarks measure final-answer speed instead of hidden reasoning traces. To benchmark thinking mode for reasoning tasks:

```bash
VICTOR_PROFILE=profiles/laptop-8gb-thinking.env ./scripts/benchmark.sh evals/reasoning.jsonl
```

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
5. Run `scripts/benchmark.sh` and compare generation tokens/sec.
6. Record observations in `runs/`.
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

See `LOCAL_MODEL_DEPLOY_PLAN.md` for the planning notes and model ranking.
