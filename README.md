<p align="center"><img src="docs/sotto.svg" alt="Sotto — give your agent a voice, not a pause" width="100%"></p>

# Sotto

**Speech that starts before the answer ends.**

Sotto turns an async stream of text into small, ordered pieces of speech. Give it
the tokens from your agent and a speech synthesizer. Play each audio chunk as it
arrives. Stop the turn with an `AbortSignal`.

No agent framework. No provider lock-in. No mandatory cloud service. The TypeScript
core has **zero runtime dependencies**; the optional Python runtime runs Kokoro on
your own GPU and Whisper on CPU.

## Use it

Requires Node 22.19 or newer. Until an npm release is published, clone this
repository and run `npm install && npm run build`, then use `npm install /path/to/sotto-voice`
in your application. The package name is `@hffmnn/sotto-voice`.

```ts
import { createOpenAiSpeechSynthesizer, streamSpeech } from "@hffmnn/sotto-voice";

const controller = new AbortController();
const synthesizer = createOpenAiSpeechSynthesizer({
  baseUrl: "http://127.0.0.1:8935/v1",
  apiKey: process.env.SOTTO_API_KEY,
  voice: "af_heart",
});

// An async iterable of text deltas from any model or agent framework.
async function* reply() {
  yield "Let me check that. ";
  yield "The film starts at eight.";
}

for await (const chunk of streamSpeech(reply(), { synthesizer, signal: controller.signal })) {
  // chunk.data is a complete PCM16 WAV. Queue it on your audio player.
  // chunk.text, chunk.index and chunk.synthesisMs support captions and timing.
  await player.enqueue(chunk.data);
}

// Call this on interruption, dismiss, or the start of a replacement turn.
controller.abort();
```

`player` is your application's audio output, not a Sotto API. Keep its own playback
queue bounded: returning immediately from `enqueue` without a limit defeats any
upstream backpressure.

## How it flows

![Text generation, sentence segmentation, bounded synthesis and ordered playback overlap in time.](docs/pipeline.svg)

`segmentText()` emits completed sentences as soon as punctuation arrives. It keeps
common abbreviations and decimals intact, flushes unfinished trailing text, and
bounds an unpunctuated stretch. An earlier comma/semicolon clause can start speech
before a long sentence finishes.

`streamSpeech()` synthesizes one segment at a time while reading a small number
of future segments. Consumer backpressure bounds lookahead; cancellation stops
future work and discards late audio even if a provider ignores its signal.

This is **sentence streaming**, not phoneme-level or audio-token streaming.
Kokoro produces the whole short segment before Sotto yields it. That distinction
matters when comparing time-to-first-audio numbers.

## Controls

| Option | Default | Purpose |
| --- | --- | --- |
| `maxCharacters` | 240 | Split long unpunctuated utterances at a nearby space |
| `clauseCharacters` | 80 | Allow an early comma/semicolon boundary |
| `maxPendingSentences` | 2 | Bound text lookahead; synthesis remains serial |
| `signal` | — | Cancel source consumption and active synthesis |

Bring another speech engine by implementing this interface:

```ts
interface SpeechSynthesizer {
  synthesize(text: string, options: { signal: AbortSignal }): Promise<{
    data: Uint8Array;
    mimeType: "audio/wav";
  }>;
}
```

The OpenAI-compatible adapter rejects redirects, credential-bearing URLs, oversized
responses and malformed/non-PCM WAV audio. It imposes a timeout and does not include
provider response bodies or secrets in errors.

## Local speech

See [the runtime guide](runtime/README.md). The optional service provides:

- Kokoro-82M, stock voices, CUDA or an explicitly selected CPU device.
- Whisper small/int8 on CPU, leaving GPU headroom for speech synthesis.
- OpenAI-compatible speech and transcription endpoints on loopback with bearer auth.
- One inference at a time, bounded admission, recording/text limits and no transcript logs.

### A measured reference, not a promise

On an RTX 4050 Laptop GPU with 6 GB VRAM, Kokoro 0.9.4 / `af_heart` generated
a 93-character utterance (5.725 seconds of audio) in **152 ms warm**. Its first
model chunk arrived at 150 ms. Peak PyTorch CUDA allocation across the two-utterance
probe was **658 MiB**. Cold first inference took **2.744 seconds**, after a separate
3.058-second model load. Warm the model before accepting a conversation.

These are local synthesis measurements, not microphone-to-speaker latency, and
CUDA allocation excludes driver/runtime overhead. Model quality is subjective;
no claim is made that the smallest model tops the quality leaderboard. See
[model selection and sources](docs/models.md).

A second real service probe on an RTX 3070 Ti (8 GB) used about **898 MiB** of
process GPU memory. Through Sotto's TypeScript adapter over loopback HTTP, the
first short sentence arrived in **107 ms**, and two sentences completed synthesis
in **200 ms** total. CPU/int8 transcription of the second synthetic sentence took
**1.058 seconds** and returned its words correctly. These figures still exclude
LLM reasoning, microphone capture, network-to-TV delivery and playback. They are
not a claim of a live conversational round-trip.

## Conversation without the theatre

Let the agent choose a short acknowledgment when it actually needs to look
something up. Speak it as an ordinary first sentence. Do not prepend “Hmm” to
every answer, invent fake progress, or keep talking over the user. Sotto never
inserts filler automatically and knows nothing about tool permissions.

Your application owns microphone consent, voice activity detection, audio focus,
playback, durable conversation and agent tools. Neither Pi nor ADB belongs in
this package. There is no always-on recorder, voice cloning or telemetry.

## Development

```sh
npm install
npm run typecheck
npm test
```

The focused tests cover early synthesis, bounded lookahead, ordering, cancellation,
segmentation, and the real HTTP adapter contract. Runtime route tests use a fake
engine; they do not establish model quality or CUDA compatibility.

## License

MIT for this code and original diagrams. Kokoro weights are Apache-2.0;
Whisper/faster-whisper have their own MIT licenses. Models and their licenses
are not bundled or relicensed by Sotto. See [LICENSE](LICENSE).
