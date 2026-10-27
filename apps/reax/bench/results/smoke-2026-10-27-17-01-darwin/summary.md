# Live benchmark summary

Means are over the cells that ran; cells the run never started are counted as not run.

| Backend | Cells run | Not run | Mean accuracy | Hits | Wrong | Label errors | Parse errors | Errors | Mean s | Cost USD | Models |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| local | 5 | 0 | 0.000 | 0/23 | 0 | 0 | 5 | 0 | 57.9 | 0.000 | /Users/crysiscodev_x/Models/Qwen3.5-9B-Q4_K_M.gguf |

Machine during the run: 2287-3442 MiB reported free of 49152 MiB, load average 5.1-18.3 on 14 CPUs. The bench does not assume it has the machine to itself: times are descriptive, noisy, and not comparable across runs.

Local model ran on: darwin arm64, llama.cpp metal on MTL0: Apple M4 Pro.

Local model server: closed after the run (exit and freed port confirmed, 91 ms).

# Live benchmark summary

Means are over the cells that ran; cells the run never started are counted as not run.

| Backend | Cells run | Not run | Mean accuracy | Hits | Wrong | Label errors | Parse errors | Errors | Mean s | Cost USD | Models |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| hybrid | 5 | 0 | 0.720 | 18/23 | 2 | 0 | 1 | 0 | 174.8 | 1.265 | claude-opus-5-5 + /Users/crysiscodev_x/Models/Qwen3.5-9B-Q4_K_M.gguf + gpt-6.1-sol |

Machine during the run: 632-3905 MiB reported free of 49152 MiB, load average 4.8-6.3 on 14 CPUs. The bench does not assume it has the machine to itself: times are descriptive, noisy, and not comparable across runs.

Local model ran on: darwin arm64, llama.cpp metal on MTL0: Apple M4 Pro.

Hybrid: the local worker's first answers averaged 0.335; after review, 0.720.

Local model server: closed after the run (exit and freed port confirmed, 115 ms).
