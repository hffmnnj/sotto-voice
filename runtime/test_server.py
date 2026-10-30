import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from server import create_app, load_engine


class StockEngine:
    device = "test"
    def speak(self, text, voice):
        return b"wave-test-audio"
    def transcribe(self, audio, content_type):
        return "Open the app."


class BreezeEngine(StockEngine):
    tts_model = "breeze-tts-2-q8_0"
    models = {"breeze-tts-2-q8_0"}
    voices = {"breeze"}
    default_voice = "breeze"

    def __init__(self):
        self.calls = []
        self.closed = False

    def speak(self, text, voice):
        self.calls.append((text, voice))
        return super().speak(text, voice)

    def close(self):
        self.closed = True


class RuntimeTests(unittest.TestCase):
    def test_engine_selection_defaults_to_kokoro_and_breeze_is_opt_in(self):
        kokoro, breeze = StockEngine(), BreezeEngine()
        with patch("server.KokoroWhisper", return_value=kokoro) as load_kokoro, patch("server.BreezeWhisper", return_value=breeze) as load_breeze:
            with patch.dict(os.environ, {"SOTTO_DEVICE": "cpu"}, clear=True):
                self.assertIs(load_engine(), kokoro)
                load_kokoro.assert_called_once_with("cpu")
            with patch.dict(os.environ, {"SOTTO_TTS_ENGINE": "breeze", "SOTTO_DEVICE": "cuda"}, clear=True):
                self.assertIs(load_engine(), breeze)
                load_breeze.assert_called_once_with("cuda")
            with patch.dict(os.environ, {"SOTTO_TTS_ENGINE": "other"}, clear=True):
                with self.assertRaises(ValueError):
                    load_engine()

    def test_auth_required_and_valid_token_reaches_inference(self):
        with TestClient(create_app(StockEngine(), "x" * 32)) as client:
            body = {"input": "Hello."}
            self.assertEqual(client.post("/v1/audio/speech", json=body).status_code, 401)
            result = client.post("/v1/audio/speech", json=body, headers={"Authorization": "Bearer " + "x" * 32})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.content, b"wave-test-audio")

    def test_selected_engine_resolves_defaults_and_rejects_wrong_model_or_voice(self):
        engine = BreezeEngine()
        headers = {"Authorization": "Bearer " + "x" * 32}
        with TestClient(create_app(engine, "x" * 32)) as client:
            self.assertEqual(client.get("/health").json()["ttsModel"], "breeze-tts-2-q8_0")
            self.assertEqual(client.post("/v1/audio/speech", json={"input": "Hello."}, headers=headers).status_code, 200)
            self.assertEqual(client.post("/v1/audio/speech", json={"input": "Next.", "model": "breeze-tts-2-q8_0", "voice": "breeze"}, headers=headers).status_code, 200)
            for override in ({"model": "kokoro"}, {"voice": "af_heart"}, {"model": None}, {"voice": None}):
                with self.subTest(override=override):
                    self.assertEqual(client.post("/v1/audio/speech", json={"input": "Hello.", **override}, headers=headers).status_code, 422)
            self.assertEqual(engine.calls, [("Hello.", "breeze"), ("Next.", "breeze")])
        self.assertTrue(engine.closed)

    def test_kokoro_rejects_breeze_settings(self):
        with TestClient(create_app(StockEngine(), "x" * 32)) as client:
            headers = {"Authorization": "Bearer " + "x" * 32}
            for override in ({"model": "breeze-tts-2-q8_0"}, {"voice": "breeze"}):
                with self.subTest(override=override):
                    self.assertEqual(client.post("/v1/audio/speech", json={"input": "Hello.", **override}, headers=headers).status_code, 422)

    def test_bounds_reject_before_model_and_upload_contract_works(self):
        with TestClient(create_app(StockEngine(), "x" * 32)) as client:
            headers = {"Authorization": "Bearer " + "x" * 32}
            self.assertEqual(client.post("/v1/audio/speech", json={"input": "x" * 1201}, headers=headers).status_code, 422)
            self.assertEqual(client.post("/v1/audio/transcriptions", files={"file": ("clip.wav", b"x" * (2 * 1024 * 1024 + 1), "audio/wav")}, headers=headers).status_code, 413)
            result = client.post("/v1/audio/transcriptions", files={"file": ("clip.webm", b"test-audio", "audio/webm")}, headers=headers)
            self.assertEqual(result.json(), {"text": "Open the app."})


if __name__ == "__main__":
    unittest.main()
