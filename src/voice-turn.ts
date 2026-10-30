import { abortable, streamSpeech } from "./stream.js";
import type { SpeechChunk, VoiceInput, VoiceTurnOptions } from "./types.js";

function transcript(text: string): string {
  if (typeof text !== "string" || !text.trim() || text.length > 4000) {
    throw new RangeError("Voice input must contain between 1 and 4000 characters");
  }
  return text.trim();
}

/** Compose recognition, a streamed model response, and ordered sentence audio. */
export async function* streamVoiceTurn(
  input: VoiceInput,
  options: VoiceTurnOptions,
): AsyncGenerator<SpeechChunk> {
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  let source: AsyncIterator<string> | undefined;
  try {
    signal.throwIfAborted();
    let text: string;
    if (input.type === "audio") {
      if (!(input.data instanceof Uint8Array) || input.data.byteLength === 0 || input.data.byteLength > 2 * 1024 * 1024) {
        throw new RangeError("Recording must contain between 1 byte and 2 MiB");
      }
      if (typeof input.mimeType !== "string" || input.mimeType.length > 128 || !/^audio\/[a-z0-9.+-]+(?:;[^\r\n]*)?$/i.test(input.mimeType)) {
        throw new TypeError("Recording must have an audio MIME type");
      }
      if (!options.recognizer) throw new TypeError("Audio input requires a speech recognizer");
      options.onState?.("transcribing");
      signal.throwIfAborted();
      text = transcript(await abortable(options.recognizer.transcribe(input.data, input.mimeType, signal), signal));
    } else if (input.type === "text") {
      text = transcript(input.text);
    } else {
      throw new TypeError("Voice input must be text or audio");
    }
    signal.throwIfAborted();
    options.onTranscript?.({ role: "user", text, final: true });
    signal.throwIfAborted();
    options.onState?.("thinking");
    signal.throwIfAborted();
    const iterator = options.responder.respond(text, { signal })[Symbol.asyncIterator]();
    source = iterator;
    async function* response(): AsyncGenerator<string> {
      for (;;) {
        const part = await abortable(Promise.resolve(iterator.next()), signal);
        signal.throwIfAborted();
        if (part.done) return;
        options.onTranscript?.({ role: "assistant", text: part.value, final: false });
        yield part.value;
      }
    }
    for await (const chunk of streamSpeech(response(), { ...options, signal })) {
      signal.throwIfAborted();
      options.onState?.("speaking");
      yield chunk;
    }
    signal.throwIfAborted();
    options.onTranscript?.({ role: "assistant", text: "", final: true });
  } finally {
    lifetime.abort();
    // Third-party model sources may ignore cancellation; do not block turn replacement.
    void Promise.resolve(source?.return?.()).catch(() => {});
  }
}
