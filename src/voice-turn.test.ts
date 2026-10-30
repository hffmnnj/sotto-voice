import { test } from "node:test";
import assert from "node:assert/strict";
import { streamVoiceTurn } from "./voice-turn.js";
import type {
  SpeechAudio,
  SpeechRecognizer,
  VoiceResponder,
  VoiceTranscript,
  VoiceTurnOptions,
  VoiceTurnPhase,
} from "./types.js";

const audio: SpeechAudio = { data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" };

function collect() {
  const transcripts: VoiceTranscript[] = [];
  const states: VoiceTurnPhase[] = [];
  const options: Pick<VoiceTurnOptions, "onTranscript" | "onState"> = {
    onTranscript: (entry) => { transcripts.push(entry); },
    onState: (phase) => { states.push(phase); },
  };
  return { transcripts, states, options };
}

test("audio turn routes ports in order and reports transcripts and states", async () => {
  const seen: { data?: Uint8Array; mimeType?: string; signal?: AbortSignal } = {};
  const recognizer: SpeechRecognizer = {
    transcribe: (data, mimeType, signal) => {
      seen.data = data;
      seen.mimeType = mimeType;
      seen.signal = signal;
      return Promise.resolve("  Hello world. How are you?  ");
    },
  };
  let responderInput = "";
  const responder: VoiceResponder = {
    respond: (text) => {
      responderInput = text;
      return (async function* () {
        yield "Hello wo";
        yield "rld. How are";
        yield " you?";
      })();
    },
  };
  const synthesized: string[] = [];
  const { transcripts, states, options } = collect();
  const chunks = await Array.fromAsync(streamVoiceTurn(
    { type: "audio", data: new Uint8Array([9, 9]), mimeType: "audio/wav;codecs=opus" },
    {
      ...options,
      recognizer,
      responder,
      synthesizer: { synthesize: async (text) => { synthesized.push(text); return audio; } },
    },
  ));

  assert.deepEqual(Array.from(seen.data ?? []), [9, 9]);
  assert.equal(seen.mimeType, "audio/wav;codecs=opus");
  assert.ok(seen.signal instanceof AbortSignal);
  assert.equal(responderInput, "Hello world. How are you?");
  assert.deepEqual(chunks.map((chunk) => [chunk.index, chunk.text]), [
    [0, "Hello world."],
    [1, "How are you?"],
  ]);
  assert.deepEqual(synthesized, ["Hello world.", "How are you?"]);
  assert.deepEqual(transcripts, [
    { role: "user", text: "Hello world. How are you?", final: true },
    { role: "assistant", text: "Hello wo", final: false },
    { role: "assistant", text: "rld. How are", final: false },
    { role: "assistant", text: " you?", final: false },
    { role: "assistant", text: "", final: true },
  ]);
  assert.deepEqual(states, ["transcribing", "thinking", "speaking", "speaking"]);
});

test("invalid or oversized input fails before recognition or response", async () => {
  let recognized = 0;
  let responded = 0;
  let synthesized = 0;
  const recognizer: SpeechRecognizer = {
    transcribe: async () => { recognized++; return "hello"; },
  };
  const responder: VoiceResponder = {
    respond: () => { responded++; throw new Error("must not respond"); },
  };
  const base = {
    recognizer,
    responder,
    synthesizer: { synthesize: async () => { synthesized++; return audio; } },
  } satisfies Partial<VoiceTurnOptions>;

  const blankRecognizer: SpeechRecognizer = { transcribe: async () => "   \n " };
  const cases: Array<{
    name: string;
    input: Parameters<typeof streamVoiceTurn>[0];
    options: VoiceTurnOptions;
    error: new (...args: Array<never>) => Error;
  }> = [
    {
      name: "empty recording",
      input: { type: "audio", data: new Uint8Array(0), mimeType: "audio/wav" },
      options: { ...base } as VoiceTurnOptions,
      error: RangeError,
    },
    {
      name: "oversized recording",
      input: { type: "audio", data: new Uint8Array(2 * 1024 * 1024 + 1), mimeType: "audio/wav" },
      options: { ...base } as VoiceTurnOptions,
      error: RangeError,
    },
    {
      name: "non-audio MIME",
      input: { type: "audio", data: new Uint8Array([1]), mimeType: "text/plain" },
      options: { ...base } as VoiceTurnOptions,
      error: TypeError,
    },
    {
      name: "audio without recognizer",
      input: { type: "audio", data: new Uint8Array([1]), mimeType: "audio/wav" },
      options: { responder, synthesizer: base.synthesizer },
      error: TypeError,
    },
    {
      name: "blank text",
      input: { type: "text", text: "   " },
      options: { ...base } as VoiceTurnOptions,
      error: RangeError,
    },
    {
      name: "oversized text",
      input: { type: "text", text: "x".repeat(4001) },
      options: { ...base } as VoiceTurnOptions,
      error: RangeError,
    },
    {
      name: "blank transcript",
      input: { type: "audio", data: new Uint8Array([1]), mimeType: "audio/wav" },
      options: { ...base, recognizer: blankRecognizer } as VoiceTurnOptions,
      error: RangeError,
    },
  ];

  for (const { name, input, options, error } of cases) {
    const { transcripts, states, options: callbacks } = collect();
    await assert.rejects(
      Array.fromAsync(streamVoiceTurn(input, { ...options, ...callbacks })),
      error,
      name,
    );
    assert.equal(recognized, 0, `${name} reached the recognizer`);
    assert.equal(responded, 0, `${name} reached the responder`);
    assert.equal(synthesized, 0, `${name} reached synthesis`);
    assert.deepEqual(transcripts, [], `${name} published a transcript`);
    assert.ok(
      states.length === 0 || (name === "blank transcript" && states.length === 1),
      `${name} published unexpected states: ${states.join(",")}`,
    );
  }
});

test("abort during unresponsive recognition rejects promptly and suppresses later model work", async () => {
  let releaseRecognizer!: (text: string) => void;
  let recognitionStarted!: () => void;
  const recognitionStartedBarrier = new Promise<void>((resolve) => { recognitionStarted = resolve; });
  const recognizer: SpeechRecognizer = {
    transcribe: () => {
      recognitionStarted();
      return new Promise<string>((resolve) => { releaseRecognizer = resolve; });
    },
  };
  let responded = 0;
  const responder: VoiceResponder = {
    respond: () => { responded++; throw new Error("must not respond"); },
  };
  const { transcripts, states, options } = collect();
  const controller = new AbortController();
  const turn = streamVoiceTurn(
    { type: "audio", data: new Uint8Array([1]), mimeType: "audio/wav" },
    {
      ...options,
      signal: controller.signal,
      recognizer,
      responder,
      synthesizer: { synthesize: async () => { throw new Error("must not synthesize"); } },
    },
  );

  const pending = turn.next();
  await recognitionStartedBarrier;
  controller.abort();
  // The recognizer ignores cancellation and never settles on its own, so a
  // rejection here proves the turn did not wait for it.
  await assert.rejects(pending, { name: "AbortError" });

  // The late recognition result arrives after cancellation and must not start
  // a response, publish transcripts, or close with a successful final marker.
  releaseRecognizer("late text");
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(responded, 0);
  assert.ok(!transcripts.some((entry) => entry.role === "assistant" && entry.final));
  assert.deepEqual(transcripts, []);
  assert.deepEqual(states, ["transcribing"]);
  await turn.return(undefined);
});

test("early consumer return closes a still-active source without hanging", async () => {
  let responderSignal: AbortSignal | undefined;
  let responderReturnCalled = false;
  let calls = 0;
  const responder: VoiceResponder = {
    respond: (_text, { signal }) => {
      responderSignal = signal;
      const source: AsyncIterator<string> & AsyncIterable<string> = {
        [Symbol.asyncIterator]() { return source; },
        next(): Promise<IteratorResult<string>> {
          calls++;
          if (calls === 1) {
            return Promise.resolve({ value: "First sentence. Second sentence. ", done: false });
          }
          return new Promise<IteratorResult<string>>(() => {});
        },
        return(): Promise<IteratorResult<string>> {
          responderReturnCalled = true;
          return new Promise<IteratorResult<string>>(() => {});
        },
      };
      return source;
    },
  };
  const { transcripts, options } = collect();
  const turn = streamVoiceTurn(
    { type: "text", text: "go" },
    {
      ...options,
      responder,
      synthesizer: { synthesize: async () => audio },
    },
  );

  const first = await turn.next();
  assert.equal(first.value?.text, "First sentence.");
  // Let the producer reach the still-active source so return() must clean it up.
  for (let i = 0; i < 1000 && calls < 2; i++) await Promise.resolve();
  assert.equal(calls, 2, "producer did not reach the still-active source");
  // Settles even though the source ignores cancellation and its return() hangs.
  const closed = await turn.return(undefined);
  assert.equal(closed.done, true);

  assert.ok(responderReturnCalled, "source was not closed");
  assert.ok(responderSignal?.aborted, "responder did not observe cancellation");
  assert.ok(!transcripts.some((entry) => entry.role === "assistant" && entry.final));
  assert.deepEqual(
    transcripts.filter((entry) => entry.role === "assistant" && !entry.final).map((entry) => entry.text),
    ["First sentence. Second sentence. "],
  );
});
