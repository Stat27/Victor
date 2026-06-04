# Victor Local Model Deployment Plan

## Goal

Deploy a local general-chat model named `victor` on user's workstation using Ollama.

The first milestone is a working local assistant that can be used from the terminal and through a local HTTP API. Docker and `llama.cpp` are intentionally deferred until Ollama is proven insufficient for speed, control, or compatibility.

## Current Hardware

From the host `nvidia-smi` output on June 1, 2026:

- GPU: NVIDIA RTX PRO 1000 Blackwell
- VRAM: 8,151 MiB
- Driver: 580.159.03
- CUDA: 13.0
- Current idle GPU memory already in use: about 1.3 GiB

This means the first model should be powerful but still realistic for 8 GB VRAM. A modern 7B to 9B model is the best target. Larger 12B to 14B models can be tested, but they may spill into system RAM and run slower.

## Runtime Choice

Use Ollama first.

Ollama advantages:

- Simple install and service management on Linux.
- Built-in model download and local model registry.
- Easy custom model name: `victor`.
- Local terminal chat with `ollama run victor`.
- Local HTTP API on `localhost:11434`.
- Less manual tuning than `llama.cpp`.

`llama.cpp` remains useful later if we need exact GGUF file control, lower-level GPU offload tuning, custom quantization choices, or tighter performance experiments.

## Model Ranking

Start with:

```bash
qwen3.5:9b
```

Reasoning:

- It is the best balance of model reputation, quality, and local fit for this 8 GB GPU.
- The Onyx self-hosted LLM leaderboard places Qwen3.5-9B in A tier, which is unusually strong for a model this size.
- Ollama lists `qwen3.5:9b` at 6.6 GB, 9.65B parameters, Q4_K_M quantization, and a 256K context window.
- It is stronger than the earlier 3B to 4B plan while still being much more practical than 14B+ models on this machine.

Ranking for this workstation:

| Rank | Model | Why | Local Fit |
| ---: | --- | --- | --- |
| 1 | `qwen3.5:9b` | Best overall choice. Strong Onyx ranking, modern Qwen3.5 family, good general chat, tools/thinking support, and realistic 6.6 GB Ollama size. | Best pick |
| 2 | `qwen3.5:4b` | Also ranked highly by Onyx and very fast, but likely below the quality target because the original 3B-class plan was not enough. | Very safe |
| 3 | `deepseek-r1:8b` | Strong reasoning model, especially for math and logic. Less ideal as a daily general chat model because reasoning models can be verbose. | Good |
| 4 | `deepseek-r1:14b` | Best 14B-style reasoning candidate from the Onyx list. It is attractive for hard reasoning, but Ollama lists it around 9 GB, so it is tight for 8 GB VRAM. | Borderline |
| 5 | `gemma3:12b` | Good general chat and long-context option, but not as compelling as Qwen3.5-9B for this machine. | Very tight |
| 6 | `phi4:14b` | Good compact reasoning and math reputation, but lower overall Onyx tier and smaller context than the top choices. | Borderline |
| 7 | `llama3.1:8b` | Stable, widely used, and predictable. Good fallback, but weaker benchmark reputation than Qwen3.5-9B. | Good |
| 8 | `qwen3:14b` | Older than Qwen3.5 and larger than the clean VRAM budget. Not worth choosing over Qwen3.5-9B first. | Borderline |
| 9 | `gpt-oss:20b` | Stronger model class with good agentic/reasoning reputation, but Ollama lists it around 14 GB. | Not practical |
| 10 | `qwen3.5:27b` | Larger Qwen3.5 model with stronger potential quality, but Ollama lists it around 17 GB. | Not practical |
| 11 | `qwen3.5:35b` | Larger Qwen3.5 MoE option, but Ollama lists it around 24 GB. | Not practical |
| 12 | `qwen3.5:397b` | Flagship Qwen3.5-class model and very strong on Onyx, but it is not a local laptop GPU target. | Not practical |

The important practical constraint is that Qwen3.5 does not currently provide a 14B local Ollama tag. It jumps from 9B to 27B, so `qwen3.5:9b` is the best target for the requested 7B to 14B quality range.

Fallback options if memory or speed is poor:

```bash
qwen3.5:4b
deepseek-r1:8b
llama3.1:8b
```

## Deployment Steps

### 1. Install Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Start Ollama

```bash
sudo systemctl enable --now ollama
sudo systemctl status ollama
```

### 3. Verify the Environment

```bash
nvidia-smi
ollama --version
```

### 4. Pull the Base Model

```bash
ollama pull qwen3.5:9b
```

### 5. Create the Victor Modelfile

Create a file named `Modelfile`:

```text
FROM qwen3.5:9b

SYSTEM """
You are Victor, a local general-purpose assistant running on user's workstation.
Be concise, practical, and clear. Prefer direct answers and ask follow-up questions only when needed.
"""
```

### 6. Build the Named Local Model

```bash
ollama create victor -f Modelfile
```

### 7. Run Victor Interactively

```bash
ollama run victor
```

Test prompt:

```text
Introduce yourself in one sentence.
```

### 8. Test the Local HTTP API

```bash
curl http://localhost:11434/api/chat \
  -d '{
    "model": "victor",
    "messages": [
      {"role": "user", "content": "Introduce yourself in one sentence."}
    ],
    "stream": false
  }'
```

## Success Criteria

- `ollama list` shows `qwen3.5:9b` and `victor`.
- `ollama run victor` starts a working local chat session.
- The HTTP API responds on `localhost:11434`.
- `nvidia-smi` shows Ollama using GPU memory during generation.
- The workstation remains responsive while Victor is running.

## Troubleshooting

If Ollama is installed but unavailable:

```bash
sudo systemctl restart ollama
sudo systemctl status ollama
```

If GPU usage does not appear during generation:

```bash
nvidia-smi
journalctl -u ollama -n 100 --no-pager
```

If Ollama falls back to CPU after suspend or driver issues, try:

```bash
sudo systemctl restart ollama
```

If that is not enough, reload NVIDIA UVM:

```bash
sudo rmmod nvidia_uvm
sudo modprobe nvidia_uvm
sudo systemctl restart ollama
```

If the model is too slow or uses too much memory, switch to a smaller base model:

```bash
ollama pull qwen3.5:4b
```

Then update the `Modelfile`:

```text
FROM qwen3.5:4b
```

And recreate Victor:

```bash
ollama create victor -f Modelfile
```

## Later Improvements

- Add a small shell script for starting and testing Victor.
- Add a local web UI if terminal and API use are not enough.
- Benchmark `qwen3.5:9b` against `deepseek-r1:8b`, `deepseek-r1:14b`, and `gemma3:12b`.
- Consider `llama.cpp` only if Ollama cannot provide the needed control or performance.
