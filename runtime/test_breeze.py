import ctypes
import io
import struct
import unittest
import wave
from unittest.mock import patch

from breeze import Breeze


class NativeFunction:
    def __init__(self, function):
        self.function = function
    def __call__(self, *args):
        return self.function(*args)


class NativeLibrary:
    def __init__(self, blocks):
        self.blocks = blocks
        self.freed = []
        self.breeze_init = NativeFunction(lambda _path, _gpu: 1)
        self.breeze_sample_rate = NativeFunction(lambda _ctx: 24000)
        self.breeze_free = NativeFunction(self.freed.append)
        self.breeze_last_error = NativeFunction(lambda: b"")
        self.breeze_generate = NativeFunction(self.generate)
    def generate(self, _ctx, _request, callback, _user):
        for block in self.blocks:
            if block == "oversize":
                values = (ctypes.c_float * 1)(0.0)
                count = 1_440_001
            else:
                values = (ctypes.c_float * len(block))(*block)
                count = len(block)
            stop = callback(values, count, None)
            for i in range(len(values)):
                values[i] = 0
            if stop:
                break
        return 0


class BreezeOutputTests(unittest.TestCase):
    def engine(self, blocks):
        with patch("breeze.Path.resolve", return_value="/libbreeze.so"), patch("breeze.ctypes.CDLL", return_value=NativeLibrary(blocks)):
            return Breeze("/libbreeze.so", "/breeze-tts-2-q8_0.gguf", "cpu")

    def test_callback_copies_and_produces_bounded_pcm16_wav(self):
        engine = self.engine([[-2.0, -1.0, 0.5], [1.0, 2.0]])
        try:
            with wave.open(io.BytesIO(engine.speak("Synthetic test.")), "rb") as wav:
                self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()), (1, 2, 24000, 5))
                self.assertEqual(struct.unpack("<5h", wav.readframes(5)), (-32767, -32767, 16383, 32767, 32767))
        finally:
            engine.close()

    def test_empty_nonfinite_and_oversized_output_are_rejected(self):
        for blocks in ([], [[float("nan")]], [[float("inf")]], ["oversize"]):
            with self.subTest(blocks=blocks):
                engine = self.engine(blocks)
                try:
                    with self.assertRaises(ValueError):
                        engine.speak("Synthetic test.")
                finally:
                    engine.close()

    def test_closing_releases_context_once_and_prevents_further_synthesis(self):
        engine = self.engine([[0.5]])
        library = engine._lib
        engine.close()
        engine.close()
        self.assertEqual(library.freed, [1])
        with self.assertRaises(RuntimeError):
            engine.speak("Synthetic test.")


if __name__ == "__main__":
    unittest.main()
