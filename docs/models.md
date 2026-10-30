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

## Desktop choice: Breeze TTS 2 Q4

Desktop uses the Q4_K local build while Kokoro remains the
public default and rollback path. JSON model id `breeze-tts-2-q4_k`, voice
`breeze`: an original reference-free designed voice, no voice cloning.

- Native runtime [Breeze-TTS-2.cpp v0.1.3 (Vulkan)](https://github.com/HoppouAI/Breeze-TTS-2.cpp)
  (Apache-2.0 C++ with separate third-party notices) plus GGUF weights.
  The GGUF embeds the codec; the full PyTorch model and audio tokenizer
  are not deployed.
- Weights and self-hosted outputs are under the BreezeBlue
  research/non-commercial terms, not an open-source or commercial license.
  Personal use is authorized.
- The Artificial Analysis listing (Elo 1228) measures the provider's hosted
  voice, not these quantizations or the local designed voice.
- A real RTX 3070 Ti service probe, after representative full-sentence startup
  warmup, generated 3.36 seconds of speech in 1.078 seconds through Sotto's WAV
  adapter. Whisper transcribed its exact synthetic words in 1.243 seconds. The
  process used 2,683 MiB GPU memory after synthesis, not a measured worst-case peak.
- Kokoro synthesized the same text in 214 ms. Q4 is a quality/voice-model choice
  with a latency cost, not a claim to beat Kokoro on speed or a listening-test result.
- Initial Q8 probing after only a short “Ready” warmup took 4.996 seconds for
  3.92 seconds of audio. Q4 after a full-sentence warmup took 1.119 seconds for
  a different, unseen 3.36-second sentence in a native probe. Warmup methods
  differed, so these numbers do not establish a quantization-only speedup.
  Q4 was selected after the actual authenticated service check above.
- Q2/depth-quantized variants were not deployed. Upstream warns of cumulative
  speech-quality degradation; no additional quantization was needed for this fit.
- The Kokoro notes above stay as clearly labeled historical data, not new
  Breeze numbers.

An adapter's MIT license does not change the license of any model it connects to.
Models with different licenses can still have lawful personal/research uses;
evaluate the upstream terms for your own deployment rather than inferring rights
from this table.
