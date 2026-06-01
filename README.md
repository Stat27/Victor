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

Test the local API:

```bash
./scripts/test_api.sh
```

Run a small benchmark prompt set:

```bash
./scripts/benchmark.sh
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

Profiles define:

- `MODEL`: Ollama base model tag.
- `VICTOR_NAME`: local Ollama model alias.
- `OLLAMA_HOST`: local Ollama API base URL.
- `NUM_CTX`: requested context window for the generated `Modelfile`.

## Iteration Loop

1. Pick a model profile.
2. Pull the model with `scripts/pull_model.sh`.
3. Create or recreate Victor with `scripts/create_victor.sh`.
4. Run `scripts/test_api.sh`.
5. Run `scripts/benchmark.sh`.
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
