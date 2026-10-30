import unittest
from fastapi.testclient import TestClient
from server import create_app


class StockEngine:
    device = "test"
    def speak(self, text, voice):
        return b"wave-test-audio"
    def transcribe(self, audio, content_type):
        return "Open the app."


class RuntimeTests(unittest.TestCase):
    def test_auth_required_and_valid_token_reaches_inference(self):
        with TestClient(create_app(StockEngine(), "x" * 32)) as client:
            body = {"input": "Hello."}
            self.assertEqual(client.post("/v1/audio/speech", json=body).status_code, 401)
            result = client.post("/v1/audio/speech", json=body, headers={"Authorization": "Bearer " + "x" * 32})
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.content, b"wave-test-audio")

    def test_bounds_reject_before_model_and_upload_contract_works(self):
        with TestClient(create_app(StockEngine(), "x" * 32)) as client:
            headers = {"Authorization": "Bearer " + "x" * 32}
            self.assertEqual(client.post("/v1/audio/speech", json={"input": "x" * 1201}, headers=headers).status_code, 422)
            self.assertEqual(client.post("/v1/audio/transcriptions", files={"file": ("clip.wav", b"x" * (2 * 1024 * 1024 + 1), "audio/wav")}, headers=headers).status_code, 413)
            result = client.post("/v1/audio/transcriptions", files={"file": ("clip.webm", b"test-audio", "audio/webm")}, headers=headers)
            self.assertEqual(result.json(), {"text": "Open the app."})


if __name__ == "__main__":
    unittest.main()
