# Model selection

Sources consulted October 30, 2026. This is a fit-for-purpose choice, not a claim
that a tiny model matches the best hosted speech service.

The [Artificial Analysis Provider Voice leaderboard](https://artificialanalysis.ai/text-to-speech/leaderboard)
ranks blind listener preferences using each provider's own voices. It does not
measure consumer-GPU memory use or the latency of this runtime. Kokoro-82M v1.0
was listed at Elo 1062 ±11 (5,539 samples). Higher-ranked hosted voices exist.

Why start with Kokoro:

- [82 million parameters and Apache-2.0 weights](https://huggingface.co/hexgrad/Kokoro-82M).
- Stock voices; no reference recordings or voice-cloning consent flow.
- Real measured CUDA allocation below 700 MiB in our short reference probe, not
  a memory estimate derived from parameter count.
- Warm synthesis fast enough to overlap with sentence-wise text generation.

Other candidates remain compatible with Sotto's synthesizer interface:

| Candidate | Evidence and limitation |
| --- | --- |
| [Ming-3.0-tts-0.5B](https://huggingface.co/inclusionAI/Ming-3.0-tts-0.5B) | MIT, 0.5B, built-in voices. AA lists the Ming-3.0 family at 1187, not a benchmark of this exact local checkpoint/runtime. Consumer VRAM and latency not measured here. |
| [Chatterbox Turbo](https://github.com/resemble-ai/chatterbox) | MIT, 350M, stock voice and optional expressive tags. Hosted Chatterbox HD scores do not establish local Turbo quality. Not measured here. |
| [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) | Apache-2.0, 0.6B/1.7B; vendor advertises low-latency streaming. Its reported 97 ms is not a Sotto measurement. |
| [Breeze TTS 2](https://huggingface.co/BreezeBlue/Breeze-TTS-2) | Official eager inference uses about 7.7 GiB; a 12 GB GPU is recommended. Research/non-commercial weights, unlike Apache-licensed code. Not a 6 GB default. |
| [Fish Drama 3](https://huggingface.co/fishaudio/drama-3) | 35B MoE; research-licensed weights, benchmarks on H200. Not comparable to a 6 GB laptop deployment. |

An adapter's MIT license does not change the license of any model it connects to.
Models with different licenses can still have lawful personal/research uses;
evaluate the upstream terms for your own deployment rather than inferring rights
from this table.
