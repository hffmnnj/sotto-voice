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

Use `SOTTO_DEVICE=cpu` explicitly for machines without CUDA. A requested CUDA device
never silently becomes CPU. `/health` reports the actual selected device after
model loading and warmup. Do not expose this inference process directly to the LAN:
put your application's authenticated transport in front of it.

## Endpoints

| Route | Request | Response |
| --- | --- | --- |
| `GET /health` | none | readiness, device and model names |
| `POST /v1/audio/speech` | `{model:"kokoro",input:"Hello.",voice:"af_heart",response_format:"wav"}` | mono 24 kHz PCM16 WAV |
| `POST /v1/audio/transcriptions` | multipart `file`, WAV/webm/mp4 | `{text:"..."}` |

Inference requires `Authorization: Bearer <SOTTO_API_KEY>` (32+ ASCII characters).
POST requires `Content-Length`. Text is limited to 1,200 characters; recordings
to 2 MiB and 30 seconds of decoded mono audio. Supported stock voices are
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
