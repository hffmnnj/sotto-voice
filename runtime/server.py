"""Small, private inference service for Sotto's OpenAI-compatible speech adapter."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import hmac
import io
import os
from typing import Protocol
import wave

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

MAX_UPLOAD = 2 * 1024 * 1024
MAX_SECONDS = 30
VOICES = {"af_heart", "af_bella", "af_nicole", "am_adam", "am_michael"}


class SpeechInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input: str = Field(min_length=1, max_length=1200)
    model: str | None = None
    voice: str | None = None
    response_format: str = "wav"


class Engine(Protocol):
    device: str
    def speak(self, text: str, voice: str) -> bytes: ...
    def transcribe(self, audio: bytes, content_type: str) -> str: ...


class KokoroWhisper:
    tts_model = "kokoro-82m"
    models = frozenset({"kokoro", "kokoro-82m"})
    voices = frozenset(VOICES)
    default_voice = "af_heart"

    def __init__(self, device: str):
        import torch
        from kokoro import KPipeline
        from faster_whisper import WhisperModel

        if device not in {"cpu", "cuda"}:
            raise ValueError("SOTTO_DEVICE must be cpu or cuda")
        if device == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but is unavailable; use SOTTO_DEVICE=cpu explicitly")
        torch.set_num_threads(4)
        self.pipeline = KPipeline(lang_code="a", device=device, repo_id="hexgrad/Kokoro-82M")
        self.device = str(next(self.pipeline.model.parameters()).device)
        self.whisper = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=4, num_workers=1)
        # Warm both the model and stock voice before reporting ready.
        self.speak("Ready.", "af_heart")

    def speak(self, text: str, voice: str) -> bytes:
        import numpy as np

        pieces = [result.audio.numpy() for result in self.pipeline(text, voice=voice)]
        if not pieces:
            raise ValueError("Speech model produced no audio")
        audio = np.concatenate(pieces)
        if len(audio) > 24_000 * 60:
            raise ValueError("Generated speech exceeds duration limit")
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(24_000)
            wav.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        return output.getvalue()

    def transcribe(self, audio: bytes, content_type: str) -> str:
        import av
        import numpy as np

        # Decode before Whisper to reject long compressed clips, not after inference.
        samples = []
        length = 0
        with av.open(io.BytesIO(audio)) as container:
            if not container.streams.audio:
                raise ValueError("No audio stream")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=16_000)
            for frame in container.decode(audio=0):
                for normalized in resampler.resample(frame):
                    values = normalized.to_ndarray().reshape(-1)
                    length += len(values)
                    if length > 16_000 * MAX_SECONDS:
                        raise ValueError("Recording exceeds 30 seconds")
                    samples.append(values)
            for normalized in resampler.resample(None):
                values = normalized.to_ndarray().reshape(-1)
                length += len(values)
                if length > 16_000 * MAX_SECONDS:
                    raise ValueError("Recording exceeds 30 seconds")
                samples.append(values)
        if not samples or length < 1600:
            raise ValueError("Recording is too short")
        pcm = np.concatenate(samples).astype(np.float32) / 32768
        segments, _ = self.whisper.transcribe(pcm, language="en", beam_size=1, vad_filter=True, condition_on_previous_text=False)
        return " ".join(segment.text.strip() for segment in segments).strip()[:4000]


class BreezeWhisper(KokoroWhisper):
    tts_model = "breeze-tts-2-q8_0"
    models = frozenset({"breeze-tts-2-q8_0"})
    voices = frozenset({"breeze"})
    default_voice = "breeze"

    def __init__(self, device: str):
        from breeze import Breeze
        from faster_whisper import WhisperModel

        self.breeze = Breeze(os.environ.get("SOTTO_BREEZE_LIBRARY", ""), os.environ.get("SOTTO_BREEZE_MODEL", ""), device)
        self.tts_model = self.breeze.model_id
        self.models = frozenset({self.tts_model})
        self.device = self.breeze.device
        try:
            self.whisper = WhisperModel("small", device="cpu", compute_type="int8", cpu_threads=4, num_workers=1)
            self.speak("This is a short synthetic speech test.", "breeze")
        except BaseException:
            self.close()
            raise

    def speak(self, text: str, voice: str) -> bytes:
        return self.breeze.speak(text)

    def close(self) -> None:
        self.breeze.close()


def load_engine() -> Engine:
    selected = os.environ.get("SOTTO_TTS_ENGINE", "kokoro")
    device = os.environ.get("SOTTO_DEVICE", "cuda")
    if selected == "kokoro":
        return KokoroWhisper(device)
    if selected == "breeze":
        return BreezeWhisper(device)
    raise ValueError("SOTTO_TTS_ENGINE must be kokoro or breeze")


def create_app(engine: Engine | None = None, token: str | None = None) -> FastAPI:
    key = token if token is not None else os.environ.get("SOTTO_API_KEY", "")
    if len(key) < 32 or not key.isascii() or "\r" in key or "\n" in key:
        raise ValueError("SOTTO_API_KEY must be at least 32 ASCII characters")
    admission = asyncio.Lock()
    inference = asyncio.Lock()
    pending = 0

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        active = engine if engine is not None else await asyncio.to_thread(load_engine)
        app.state.engine = active
        try:
            yield
        finally:
            app.state.engine = None
            close = getattr(active, "close", None)
            if close is not None:
                await asyncio.to_thread(close)

    app = FastAPI(title="Sotto", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        if request.url.path != "/health":
            received = request.headers.get("authorization", "").encode("utf-8")
            if not hmac.compare_digest(received, f"Bearer {key}".encode("ascii")):
                return Response(status_code=401)
            size = request.headers.get("content-length")
            if request.method == "POST" and size is None:
                return Response(status_code=411)
            if size and (not size.isdigit() or int(size) > MAX_UPLOAD + 16_384):
                return Response(status_code=413)
        return await call_next(request)

    async def run(request: Request, operation):
        nonlocal pending
        async with admission:
            if pending >= 3:
                raise HTTPException(503, "Speech service is busy")
            pending += 1
        try:
            async with inference:
                if await request.is_disconnected():
                    raise HTTPException(499, "Request cancelled")
                task = asyncio.create_task(asyncio.to_thread(operation))
                try:
                    result = await asyncio.shield(task)
                except asyncio.CancelledError:
                    # Native kernels cannot be preempted; retain the inference lock until they settle.
                    await task
                    raise
                if await request.is_disconnected():
                    raise HTTPException(499, "Request cancelled")
                return result
        except (ValueError, EOFError):
            raise HTTPException(422, "Invalid audio or speech input") from None
        finally:
            async with admission:
                pending -= 1

    @app.get("/health")
    async def health():
        active = getattr(app.state, "engine", None)
        return {"ready": active is not None, "device": active.device if active else None, "ttsModel": getattr(active, "tts_model", "kokoro-82m") if active else None, "sttModel": "whisper-small-int8-cpu"}

    @app.post("/v1/audio/speech")
    async def speak(request: Request, body: SpeechInput):
        active = app.state.engine
        model = body.model if "model" in body.model_fields_set else getattr(active, "tts_model", "kokoro-82m")
        voice = body.voice if "voice" in body.model_fields_set else getattr(active, "default_voice", "af_heart")
        if (
            model is None or voice is None
            or model not in getattr(active, "models", {"kokoro", "kokoro-82m"})
            or voice not in getattr(active, "voices", VOICES)
            or body.response_format != "wav" or not body.input.strip()
        ):
            raise HTTPException(422, "Unsupported speech settings")
        audio = await run(request, lambda: active.speak(body.input, voice))
        return Response(audio, media_type="audio/wav", headers={"Cache-Control": "no-store"})

    @app.post("/v1/audio/transcriptions")
    async def transcribe(request: Request, file: UploadFile = File(...)):
        try:
            if file.content_type not in {"audio/wav", "audio/x-wav", "audio/webm", "audio/mp4"}:
                raise HTTPException(415, "Unsupported audio format")
            audio = await file.read(MAX_UPLOAD + 1)
            if not audio or len(audio) > MAX_UPLOAD:
                raise HTTPException(413, "Recording exceeds byte limit")
            text = await run(request, lambda: app.state.engine.transcribe(audio, file.content_type))
            return {"text": text}
        finally:
            await file.close()

    return app
