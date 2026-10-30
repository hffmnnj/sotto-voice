# Sotto API

Sotto is a model-agnostic voice-turn library. The host brings any text model,
any speech recognizer, and any speech synthesizer; Sotto composes them into
ordered, cancellable sentence audio with transcript and pipeline callbacks.

Requires Node 22.19 or newer. The TypeScript core has zero runtime
dependencies. Until an npm release is published, clone the source and run
`npm install && npm run build`, then `npm install /path/to/sotto-voice` in
your application. The package name is `@hffmnn/sotto-voice`.

## Quick start

With the optional speech runtime running, this complete echo example writes
real WAV segments to disk. Replace the echo responder with your model's streamed
text; it is not a built-in reasoning model.

```ts
import { writeFile } from "node:fs/promises";
import { createOpenAiSpeechSynthesizer, streamVoiceTurn } from "@hffmnn/sotto-voice";

// Any text model behind this port: stream string deltas, honor the signal.
const responder = {
  async *respond(text: string, options: { signal: AbortSignal }) {
    options.signal.throwIfAborted();
    yield text;
  },
};

const apiKey = process.env.SOTTO_API_KEY;
if (!apiKey) throw new Error("Set the runtime's SOTTO_API_KEY");
const synthesizer = createOpenAiSpeechSynthesizer({
  baseUrl: "http://127.0.0.1:8935/v1",
  apiKey,
});

const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
for await (const chunk of streamVoiceTurn(
  { type: "text", text: "Hello from Sotto. This is real synthesized speech." },
  {
    responder,
    synthesizer,
    signal: controller.signal,
    onTranscript: (t) => console.log(t.role, JSON.stringify(t.text), t.final),
    onState: (phase) => console.log("phase:", phase),
  },
)) {
  // chunk.data is one independently playable WAV.
  // chunk.text, chunk.index, and chunk.synthesisMs support captions and timing.
  await writeFile(`reply-${chunk.index}.wav`, chunk.data);
}
```

This uses the adapter's Kokoro defaults; explicitly select the matching model
and voice for a Breeze runtime. To play rather than save chunks, pass their bytes
to your application's player. Keep its playback queue bounded: an unlimited
queue defeats upstream backpressure. Call `controller.abort()` when the user
interrupts, dismisses, or starts a replacement turn.

An audio turn adds a recognizer and a complete recording instead of text:

```ts
for await (const chunk of streamVoiceTurn(
  { type: "audio", data: recording, mimeType: "audio/webm" },
  { responder, recognizer, synthesizer, signal: controller.signal },
)) {
  await player.enqueue(chunk.data);
}
```

The recording is a complete utterance supplied by the host. Sotto never
captures from a microphone; see [host responsibilities](#host-responsibilities).

## Functions

### `streamVoiceTurn(input, options)`

Composes recognition (audio input only), a streamed model response, and
ordered sentence audio. Returns an `AsyncGenerator<SpeechChunk>`.

```ts
import type { VoiceInput, VoiceTurnOptions } from "@hffmnn/sotto-voice";
```

Recording bounds are enforced before recognition; text and recognized transcript
bounds are enforced before calling the responder:

| Input | Rule | Failure |
| --- | --- | --- |
| `{ type: "text", text }` | Trimmed text, 1–4,000 characters | `RangeError` |
| `{ type: "audio", data, mimeType }` | `Uint8Array` of 1 byte–2 MiB; `audio/*` MIME up to 128 characters | `RangeError` for bytes, `TypeError` for MIME |
| Audio without `recognizer` | A recognizer port is required | `TypeError` |
| Unknown shape | Must be text or audio | `TypeError` |

### `streamSpeech(source, options)`

Lower-level path for hosts that already own the text stream: synthesizes one
sentence at a time while reading a bounded number of future segments.
Consumer backpressure bounds lookahead; synthesis itself is serial. See the
`streamSpeech` example in the project [README](../README.md).

### `segmentText(source, options)`

Punctuation-aware, bounded sentence/first-clause segmenter. Emits completed
sentences as punctuation arrives, keeps common abbreviations and decimals
intact, flushes unfinished trailing text, and splits overlong unpunctuated
stretches at a nearby space. An earlier comma/semicolon clause can start
speech before a long sentence finishes.

### `createOpenAiSpeechSynthesizer(options)`

OpenAI-compatible `SpeechSynthesizer` for the bundled loopback runtime (or any
endpoint that returns mono PCM WAV). Rejects redirects, credential-bearing
URLs, oversized responses, and malformed/non-PCM WAV audio. Timeouts are
enforced; provider response bodies and secrets never appear in errors.

## Ports (bring your own model)

These interfaces keep Sotto free of framework and provider coupling. Each port
must honor the supplied `AbortSignal`.

```ts
interface VoiceResponder {
  respond(text: string, options: { signal: AbortSignal }): AsyncIterable<string>;
}

interface SpeechRecognizer {
  transcribe(audio: Uint8Array, mimeType: string, signal: AbortSignal): Promise<string>;
}

interface SpeechSynthesizer {
  synthesize(text: string, options: { signal: AbortSignal }): Promise<SpeechAudio>;
}
```

An adapter that ignores cancellation still composes safely: Sotto stops
consuming its output and discards late results, but it cannot stop remote
computation the adapter leaves running. Map a slow or uncancellable backend to
a host-side timeout or replacement turn instead.

## Options, defaults, and ranges

| Option | Default | Range | Purpose |
| --- | --- | --- | --- |
| `maxCharacters` | 240 | integer 1–4,000 | Split long unpunctuated utterances at a nearby space |
| `clauseCharacters` | 80 | integer 1–4,000 | Allow an early comma/semicolon boundary |
| `maxPendingSentences` | 2 | integer 1–16 | Queued sentence lookahead, not speaker/playback credit |
| `signal` | — | `AbortSignal` | Cancel consumption and active synthesis |
| Synthesizer `timeoutMs` | 30,000 ms | 1–120,000 | Per-utterance HTTP timeout |
| Synthesizer `maxAudioBytes` | 4 MiB | 44 B–32 MiB | Largest accepted WAV response |
| Synthesizer `model` / `voice` | `"kokoro"` / `"af_heart"` | engine-dependent | Explicit per engine; Breeze needs `breeze-tts-2-q4_k` / `breeze` |
| Runtime speech text | — | 1–1,200 chars | Separate from the 4,000-char library bound |

Out-of-range integers throw `RangeError`. `maxPendingSentences` bounds how
many sentences wait ahead of playback; synthesis remains serial, so raising it
adds memory and wasted work on interruption without adding concurrency.

## Transcripts and pipeline states

`onTranscript` receives:

- `{ role: "user", text, final: true }` — the full recognized or supplied
  text, exactly once per turn.
- `{ role: "assistant", text: delta, final: false }` — each model text delta
  as it arrives.
- `{ role: "assistant", text: "", final: true }` — an empty final marker, only
  on success. A cancelled or failed turn never emits it, so hosts must not
  treat a missing marker as an empty reply.

`onState` receives `transcribing` (audio input only), then `thinking`, then
`speaking`. States describe pipeline progress: `speaking` means an audio chunk
is ready, not that the host has played it. Actual playback position stays a
host concern.

## Errors and cancellation

- Validation throws `RangeError` for out-of-bounds
  text, audio bytes, and option integers; `TypeError` for a bad MIME type, a
  missing recognizer, or a malformed input shape. Segmentation options are
  validated when the speech stream starts, not before recognition.
- Abort with the caller's `signal`, or stop consuming the generator early:
  both cancel the current turn. Pending source reads and active synthesis
  settle promptly; late audio is discarded even if a provider ignores its
  signal, and third-party iterators are released without blocking turn
  replacement.
- The HTTP adapter throws on non-2xx status (`Error` with the status code),
  missing or oversized bodies (`Error` / `RangeError`), and invalid WAV
  payloads (`Error`). Errors carry status codes and byte counts only.
- The runtime answers invalid speech settings with 422, oversized or missing
  bodies with 411/413, unauthenticated calls with 401, disconnected callers
  with 499, and overload with 503 instead of an unbounded queue.

## Prompt policy and skills

Spoken answers need different prose than chat answers: short sentences that
survive segmentation, no markdown or URLs read aloud, and an acknowledgment
only when the agent genuinely waits on a tool. That policy ships as two
framework-neutral exports:

- `AGENT_VOICE_INSTRUCTIONS` (canonical source: the
  [agent-voice skill](../skills/agent-voice/SKILL.md)) is the full startup
  policy: append it once to the model's system instructions.
- `TURN_INJECTION_INSTRUCTIONS` (canonical source: the
  [turn-injection skill](../skills/turn-injection/SKILL.md)) is the tiny
  recurring reminder: inject it as trusted host context on every model
  request, without persisting duplicates into conversation history and
  without speaking it aloud.

```ts
import {
  AGENT_VOICE_INSTRUCTIONS,
  TURN_INJECTION_INSTRUCTIONS,
} from "@hffmnn/sotto-voice";

// Compose fresh per-request context around the stored conversation. The exact
// request shape depends on your model client; the rule is append-only and
// transient: never store the reminder as a conversation turn, and never
// speak it.
const startupInstructions = [AGENT_VOICE_INSTRUCTIONS];
const requestContext = [...startupInstructions, TURN_INJECTION_INSTRUCTIONS];
```

Both are advisory text, not mechanically injected filler, and only as
effective as the model obeying them.

To install a skill, copy or symlink the repo's `skills/<name>` folder into the
host application's discovered skills directory, or import the exported
instruction string for applications with explicit prompt configuration. No
single agent brand's install path is prescribed here. Skills are discovered
guidance, not automatic hooks: installing a skill alone does not implement
injection; host code must inject the reminder on each request.

Host integration guidance for developers adding Sotto to their own
application lives in the
[sotto-development skill](../skills/sotto-development/SKILL.md).

## Host responsibilities

Sotto owns the turn pipeline only. The host owns everything around it:

- Microphone consent, capture, voice activity detection, and audio focus.
- Tool permissions and the decision to speak a short acknowledgment while a
  tool runs. Sotto never inserts filler and knows nothing about tools.
- Transport and authentication in front of the loopback runtime.
- Playback scheduling, interruption handling, and turn identity: discard
  stale audio on replacement turns using your own turn IDs.
- Durable conversation state and terminal UI.
- There is no always-on recorder, voice cloning, or telemetry in this package.

## Runtime HTTP routes

The optional Python runtime is documented in
[`runtime/README.md`](../runtime/README.md). Summary of the contract:

| Route | Request | Response |
| --- | --- | --- |
| `GET /health` | none, unauthenticated | readiness, device, and model names |
| `POST /v1/audio/speech` | `{ model, input, voice, response_format: "wav" }` | mono 24 kHz PCM16 WAV, `Cache-Control: no-store` |
| `POST /v1/audio/transcriptions` | multipart `file`, WAV / `x-wav` / webm / mp4 | `{ text }` |

Inference requires `Authorization: Bearer <SOTTO_API_KEY>` of at least 32
ASCII characters. POSTs require `Content-Length`. Speech text is limited to
1,200 characters; recordings to 2 MiB and 30 seconds of decoded audio. One
inference runs at a time with bounded admission; native kernels cannot always
be preempted, so a cancelled caller still waits for the slot to settle while
receiving nothing. Transcription runs on CPU/int8 Whisper `small`, leaving GPU
headroom for synthesis.

Current deployment reference: Breeze Q4_K served buffered WAV in about
1.08 s for 3.36 s of audio, Kokoro in 214 ms on the same synthetic text.
These are single-probe synthesis figures, not general quality claims, p95
latency, or microphone-to-speaker round-trips. See
[model selection](models.md) for sources and trade-offs.

## License boundary

MIT for this code and original diagrams. Bundled-model terms are separate and
not changed by the adapter's license: Kokoro-82M weights are Apache-2.0,
Whisper/faster-whisper have their own MIT licenses, the Breeze C++ runtime is
Apache-2.0, and Breeze weights plus self-hosted outputs are
research/non-commercial. Models are downloaded or supplied separately and are
never bundled or relicensed by Sotto. See [LICENSE](../LICENSE).
