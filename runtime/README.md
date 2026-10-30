# Local speech runtime

Python 3.12 is the tested environment. Install a CUDA-compatible PyTorch build
using the current [official selector](https://pytorch.org/get-started/locally/)
before installing the remaining requirements. Kokoro and faster-whisper download
their model weights from the respective upstream repositories on first startup.

```sh
uv venv --python 3.12 .venv
# Install the PyTorch wheel appropriate to your GPU and CUDA driver, then:
uv pip install --python .venv/bin/python -r runtime/requirements.txt
# Misaki's English frontend needs this spaCy model. Install it before switching
# to an unprivileged service account with a read-only environment.
.venv/bin/python -m spacy download en_core_web_sm
export SOTTO_API_KEY="$(openssl rand -hex 32)"
export SOTTO_DEVICE=cuda
.venv/bin/uvicorn server:create_app --factory --app-dir runtime --host 127.0.0.1 --port 8935
```

For Kokoro, use `SOTTO_DEVICE=cpu` explicitly for machines without CUDA; a requested
CUDA device never silently becomes CPU. Breeze's Vulkan fallback differs, as
described below. `/health` reports readiness after model loading and warmup.
Do not expose this inference process directly to the LAN:
put your application's authenticated transport in front of it.

## Engines

`SOTTO_TTS_ENGINE` selects the TTS backend: `kokoro` (default) or `breeze`.
Transcription stays on CPU/int8 Whisper `small` either way.

| Engine | Request | Notes |
| --- | --- | --- |
| `kokoro` | `{model:"kokoro",input:"Hello.",voice:"af_heart",response_format:"wav"}` | Stock voices `af_heart`, `af_bella`, `af_nicole`, `am_adam`, `am_michael`. |
| `breeze` | `{model:"breeze-tts-2-q4_k",input:"Hello.",voice:"breeze",response_format:"wav"}` | Q4_K or Q8_0, voice `breeze` only: an original reference-free designed voice, no voice cloning. |

The Breeze engine needs its native library and Q4 or Q8 weights:

Download the [v0.1.3 native release](https://github.com/HoppouAI/Breeze-TTS-2.cpp/releases/tag/v0.1.3)
and the chosen [GGUF weights](https://huggingface.co/HoppouAI/Breeze-TTS-2.cpp).
Keep the native bundle together so `libbreeze.so` can find its sibling libraries;
the wrapper resolves symlinks before loading it. These artifacts are not bundled
with Sotto. Follow upstream build instructions on platforms without a compatible release.

```sh
export SOTTO_TTS_ENGINE=breeze
export SOTTO_BREEZE_LIBRARY=/opt/hffmnntv-speech/libbreeze.so
export SOTTO_BREEZE_MODEL=/opt/hffmnntv-speech/models/breeze-tts-2-q4_k.gguf
```

Keep the published filename: `breeze-tts-2-q4_k.gguf` or
`breeze-tts-2-q8_0.gguf`. The runtime derives its active model id from that name
and rejects requests for the other quantization. Omitted model/voice use the
selected engine's defaults; explicit incompatible values return 422. The generic
TypeScript adapter retains Kokoro defaults, so pass Breeze's model/voice explicitly.
Breeze warms a representative full sentence before readiness; first startup can
take roughly 15 seconds while native kernels warm. Keep the service running.

For Breeze, `SOTTO_DEVICE=cuda` requests Vulkan, not CUDA/PyTorch, and the
native backend may fall back. Confirm actual GPU use in the startup logs and
`nvidia-smi`, not via the flag or advertised memory figures. The GGUF
embeds the codec; the full PyTorch model and audio tokenizer are not needed.
Upstream C++ runtime: <https://github.com/HoppouAI/Breeze-TTS-2.cpp>
(Apache-2.0 with separate third-party notices). Weights and self-hosted outputs
are under the BreezeBlue research/non-commercial terms
(<https://huggingface.co/BreezeBlue/Breeze-TTS-2>); personal use is authorized.
Do not label the weights open-source or commercially licensed.

## Endpoints

| Route | Request | Response |
| --- | --- | --- |
| `GET /health` | none | readiness, device and model names |
| `POST /v1/audio/speech` | `{model:"kokoro",input:"Hello.",voice:"af_heart",response_format:"wav"}` | mono 24 kHz PCM16 WAV |
| `POST /v1/audio/transcriptions` | multipart `file`, WAV/webm/mp4 | `{text:"..."}` |

Inference requires `Authorization: Bearer <SOTTO_API_KEY>` (32+ ASCII characters).
POST requires `Content-Length`. Text is limited to 1,200 characters; recordings
to 2 MiB and 30 seconds of decoded mono audio. Supported Kokoro stock voices are
`af_heart`, `af_bella`, `af_nicole`, `am_adam`, and `am_michael`.

There is one inference slot and at most two waiting requests. Excess load receives
503 rather than an unbounded queue. Native GPU kernels cannot necessarily be
interrupted mid-sentence; the slot remains occupied until the kernel finishes,
and disconnected/cancelled callers do not receive its result. Client applications
must also discard stale audio using turn IDs.

Whisper is `small`, CPU/int8 with four threads. This intentionally avoids loading
a second CUDA model beside TTS. Do not assume enough free VRAM from a GPU's total
capacity alone; check existing services before deployment. This service must not
stop or reconfigure unrelated GPU workloads.

## Route checks without downloading models

```sh
uv pip install --python .venv/bin/python httpx
.venv/bin/python -m unittest discover -s runtime -v
```

Tests inject an engine at the inference boundary. Run a real synthesis and inspect
`nvidia-smi` before claiming production CUDA readiness.
