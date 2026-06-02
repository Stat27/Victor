# Benchmark Memory

## qwen3.5:9b, THINK=false

- Status: runs successfully through Ollama as `victor`.
- Benchmark: 3 prompts, 90.60s total wall/API duration.
- Generated tokens: 234.
- Average generation rate: 2.72 tok/s.
- Observed Ollama GPU memory: about 5,820 MiB.
- Observed total GPU memory: about 7,177 / 8,151 MiB.
- Interpretation: usable but slow; local evidence proves it can run on this machine, though VRAM headroom is tight.

## qwen3.5:9b, thinking enabled

- Benchmark: 3 prompts, 585.53s total wall/API duration.
- Generated tokens: 3,268.
- Average generation rate: 5.62 tok/s.
- Interpretation: not suitable for daily chat because hidden thinking tokens make total responses much slower.
