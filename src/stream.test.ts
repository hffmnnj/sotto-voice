import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentText, streamSpeech } from "./index.js";

const audio = { data: new Uint8Array(44), mimeType: "audio/wav" as const };
async function* words(...values: string[]) { yield* values; }

test("segmentation preserves abbreviations, split decimals and unfinished text", async () => {
  const result = await Array.fromAsync(segmentText(words("Dr. Jones paid 3.", "14 dollars. Hmm.", " One more thing")));
  assert.deepEqual(result, ["Dr. Jones paid 3.14 dollars.", "Hmm.", "One more thing"]);
});

test("speech starts before generation completes and keeps sentence order", async () => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  async function* source() {
    yield "First sentence.";
    await waiting;
    yield "Second sentence.";
  }
  const calls: string[] = [];
  const stream = streamSpeech(source(), { synthesizer: {
    async synthesize(text) { calls.push(text); return audio; },
  } });
  try {
    const first = await stream.next();
    assert.equal(first.value?.text, "First sentence.");
    assert.deepEqual(calls, ["First sentence."]);
    release();
    assert.deepEqual((await Array.fromAsync(stream)).map((chunk) => [chunk.index, chunk.text]), [[1, "Second sentence."]]);
  } finally { release(); await stream.return(undefined); }
});

test("slow playback bounds source lookahead instead of synthesizing unbounded audio", async () => {
  let reads = 0;
  async function* source() { for (let i = 0; i < 1000; i++) { reads++; yield `Sentence ${i}!`; } }
  let synthesized = 0;
  const stream = streamSpeech(source(), { maxPendingSentences: 2, synthesizer: {
    async synthesize() { synthesized++; return audio; },
  } });
  try {
    await stream.next();
    // Drain microtasks, not wall-clock time, so the producer has a chance to fill its queue.
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(synthesized, 1);
    assert.ok(reads <= 4, `read ${reads} sentences ahead of playback`);
  } finally { await stream.return(undefined); }
});

test("abort settles a blocked source and cannot publish late synthesis", async () => {
  const controller = new AbortController();
  const stream = streamSpeech({ [Symbol.asyncIterator]() { return {
    next: () => new Promise<IteratorResult<string>>(() => {}),
  }; } }, { signal: controller.signal, synthesizer: { async synthesize() { throw new Error("must not synthesize"); } } });
  const next = stream.next();
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(next, { name: "AbortError" });

  let started!: () => void;
  const synthesizing = new Promise<void>((resolve) => { started = resolve; });
  const secondController = new AbortController();
  const second = streamSpeech(words("Hello."), { signal: secondController.signal, synthesizer: {
    async synthesize() { started(); return new Promise(() => {}); },
  } });
  const pending = second.next();
  await synthesizing;
  secondController.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
