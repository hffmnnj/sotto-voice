import type { OpenAiSpeechOptions, SpeechSynthesizer } from "./types.js";

function validPcmWave(data: Uint8Array): boolean {
  if (data.length < 46) return false;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57415645 ||
      view.getUint32(4, true) + 8 !== data.length) return false;
  let formatValid = false;
  let samplesValid = false;
  let channels = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const kind = view.getUint32(offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (size > data.length - start) return false;
    if (kind === 0x666d7420) {
      if (size < 16) return false;
      channels = view.getUint16(start + 2, true);
      const rate = view.getUint32(start + 4, true);
      formatValid = view.getUint16(start, true) === 1 && (channels === 1 || channels === 2) &&
        rate >= 8000 && rate <= 48000 && view.getUint16(start + 14, true) === 16 &&
        view.getUint16(start + 12, true) === channels * 2 &&
        view.getUint32(start + 8, true) === rate * channels * 2;
    }
    if (kind === 0x64617461) samplesValid = formatValid && size > 0 && size % (channels * 2) === 0;
    offset = start + size + (size % 2);
    if (offset > data.length) return false;
  }
  return formatValid && samplesValid;
}

export function createOpenAiSpeechSynthesizer(options: OpenAiSpeechOptions): SpeechSynthesizer {
  const url = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TypeError("Speech baseUrl must be an HTTP(S) URL without credentials, query or fragment");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/audio/speech`;
  const timeout = options.timeoutMs ?? 30_000;
  const maximum = options.maxAudioBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000 ||
      !Number.isSafeInteger(maximum) || maximum < 44 || maximum > 32 * 1024 * 1024) {
    throw new RangeError("Invalid speech timeout or audio byte limit");
  }
  if (options.apiKey && /[\r\n]/.test(options.apiKey)) throw new TypeError("Invalid speech API key");
  return {
    async synthesize(text, { signal }) {
      if (!text.trim() || text.length > 4000) throw new RangeError("Speech text must contain 1–4000 characters");
      const combined = AbortSignal.any([signal, AbortSignal.timeout(timeout)]);
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: options.model ?? "kokoro", voice: options.voice ?? "af_heart", input: text, response_format: "wav" }),
        signal: combined,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Speech service returned HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Speech service returned no audio");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maximum) throw new RangeError("Speech response exceeds audio byte limit");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
      const data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      if (!validPcmWave(data)) {
        throw new Error("Speech service returned invalid WAV audio");
      }
      combined.throwIfAborted();
      return { data, mimeType: "audio/wav" };
    },
  };
}
