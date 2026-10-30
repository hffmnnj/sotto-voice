"""ctypes adapter for the pinned Breeze TTS 2 C API."""
from __future__ import annotations

import ctypes
import io
import os
from pathlib import Path
import wave

import numpy as np

SAMPLE_RATE = 24_000
MAX_SAMPLES = SAMPLE_RATE * 60
INSTRUCTION = (
    "A warm, clear young woman with a relaxed conversational delivery, natural American English, "
    "and a calm, friendly tone. Speak naturally without theatrical emphasis."
)


class BreezeRequest(ctypes.Structure):
    _fields_ = [
        ("text", ctypes.c_char_p),
        ("instruction", ctypes.c_char_p),
        ("ref_text", ctypes.c_char_p),
        ("ref_audio", ctypes.POINTER(ctypes.c_float)),
        ("ref_audio_len", ctypes.c_int),
        ("cfg_scale", ctypes.c_float),
        ("seed", ctypes.c_int),
        ("max_new_tokens", ctypes.c_int),
        ("split_chars", ctypes.c_int),
        ("temperature", ctypes.c_float),
        ("top_k", ctypes.c_int),
        ("top_p", ctypes.c_float),
        ("repetition_penalty", ctypes.c_float),
    ]


AudioCallback = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.POINTER(ctypes.c_float), ctypes.c_int, ctypes.c_void_p)


class Breeze:
    def __init__(self, library: str, model: str, device: str):
        if device not in {"cpu", "cuda"}:
            raise ValueError("SOTTO_DEVICE must be cpu or cuda")
        if not os.path.isabs(library) or not os.path.isabs(model):
            raise ValueError("SOTTO_BREEZE_LIBRARY and SOTTO_BREEZE_MODEL must be absolute paths")
        self.model_id = Path(model).stem
        if self.model_id not in {"breeze-tts-2-q8_0", "breeze-tts-2-q4_k"}:
            raise ValueError("Breeze requires the published Q8_0 or Q4_K GGUF filename")
        self._lib = ctypes.CDLL(str(Path(library).resolve(strict=True)))
        self._lib.breeze_init.argtypes = [ctypes.c_char_p, ctypes.c_int]
        self._lib.breeze_init.restype = ctypes.c_void_p
        self._lib.breeze_sample_rate.argtypes = [ctypes.c_void_p]
        self._lib.breeze_sample_rate.restype = ctypes.c_int
        self._lib.breeze_generate.argtypes = [ctypes.c_void_p, ctypes.POINTER(BreezeRequest), AudioCallback, ctypes.c_void_p]
        self._lib.breeze_generate.restype = ctypes.c_int
        self._lib.breeze_free.argtypes = [ctypes.c_void_p]
        self._lib.breeze_free.restype = None
        self._lib.breeze_last_error.argtypes = []
        self._lib.breeze_last_error.restype = ctypes.c_char_p
        self._ctx = self._lib.breeze_init(os.fsencode(model), int(device == "cuda"))
        if not self._ctx:
            error = self._lib.breeze_last_error()
            detail = error.decode("utf-8", errors="replace") if error else "unknown native error"
            raise RuntimeError(f"Breeze model failed to load: {detail}")
        if self._lib.breeze_sample_rate(self._ctx) != SAMPLE_RATE:
            self.close()
            raise RuntimeError("Breeze model must use 24 kHz audio")
        # The API cannot report whether its Vulkan request fell back to CPU.
        self.device = "cpu" if device == "cpu" else "vulkan-requested (actual device unverified)"

    def close(self) -> None:
        if self._ctx:
            ctx, self._ctx = self._ctx, None
            self._lib.breeze_free(ctx)

    def speak(self, text: str) -> bytes:
        if not self._ctx:
            raise RuntimeError("Breeze context is closed")
        if "\x00" in text:
            raise ValueError("Speech input contains NUL")
        blocks: list[np.ndarray] = []
        length = 0
        invalid = False

        @AudioCallback
        def collect(samples, count, _user):
            nonlocal length, invalid
            try:
                if not samples or count <= 0 or length + count > MAX_SAMPLES:
                    invalid = True
                    return 1
                block = np.ctypeslib.as_array(samples, shape=(count,)).copy()
                if not np.isfinite(block).all():
                    invalid = True
                    return 1
                blocks.append(block)
                length += count
                return 0
            except Exception:
                invalid = True
                return 1

        request = BreezeRequest(text=text.encode("utf-8"), instruction=INSTRUCTION.encode("utf-8"), cfg_scale=1.0, seed=42)
        result = self._lib.breeze_generate(self._ctx, ctypes.byref(request), collect, None)
        if result != 0:
            raise RuntimeError("Breeze synthesis failed")
        if invalid or not length:
            raise ValueError("Breeze produced invalid or empty audio")
        audio = np.concatenate(blocks)
        output = io.BytesIO()
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(SAMPLE_RATE)
            wav.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        return output.getvalue()
