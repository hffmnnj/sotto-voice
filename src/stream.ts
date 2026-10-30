import type { SegmentationOptions, SpeechChunk, StreamSpeechOptions } from "./types.js";

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Speech cancelled", "AbortError");
}

export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function boundary(text: string, max: number, clause: number): number {
  for (let index = 0; index < Math.min(text.length, max); index++) {
    const character = text[index]!;
    if (!".!?。！？,;".includes(character)) continue;
    if ((character === "," || character === ";") && index < clause) continue;
    if (character === ".") {
      const prefix = text.slice(0, index + 1);
      if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)\.$/i.test(prefix)) continue;
      if (/\d/.test(text[index - 1] ?? "") &&
          (index + 1 === text.length || /\d/.test(text[index + 1]!))) continue;
      if (/[A-Za-z]/.test(text[index - 1] ?? "") && /[A-Za-z]/.test(text[index + 1] ?? "")) continue;
    }
    let end = index + 1;
    while (end < text.length && /[.!?。！？"'”’)]/.test(text[end]!)) end++;
    if (end < text.length && !/\s/.test(text[end]!) && !"。！？".includes(character)) continue;
    return end;
  }
  if (text.length >= max) {
    const space = text.lastIndexOf(" ", max);
    return space > max / 2 ? space : max;
  }
  return 0;
}

/** A punctuation-aware, bounded sentence/first-clause segmenter. */
export async function* segmentText(
  source: AsyncIterable<string>,
  options: SegmentationOptions = {},
): AsyncGenerator<string> {
  const max = positiveInteger(options.maxCharacters ?? 240, "maxCharacters", 4000);
  const clause = positiveInteger(options.clauseCharacters ?? 80, "clauseCharacters", 4000);
  let buffer = "";
  for await (const delta of source) {
    buffer += delta;
    let end: number;
    while ((end = boundary(buffer, max, clause)) > 0) {
      const sentence = buffer.slice(0, end).trim();
      buffer = buffer.slice(end).trimStart();
      if (sentence) yield sentence;
    }
  }
  if (buffer.trim()) yield buffer.trim();
}

class BoundedQueue<T> {
  private readonly values: T[] = [];
  private wake: (() => void) | undefined;
  private ended = false;
  private failure: unknown;
  private failed = false;

  constructor(private readonly capacity: number, private readonly signal: AbortSignal) {}

  private async changed(): Promise<void> {
    await abortable(new Promise<void>((resolve) => { this.wake = resolve; }), this.signal);
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  async push(value: T): Promise<void> {
    while (this.values.length >= this.capacity) await this.changed();
    this.signal.throwIfAborted();
    this.values.push(value);
    this.notify();
  }

  async shift(): Promise<T | undefined> {
    while (!this.values.length && !this.ended && !this.failed) await this.changed();
    this.signal.throwIfAborted();
    if (this.failed) throw this.failure;
    const value = this.values.shift();
    this.notify();
    return value;
  }

  finish(error?: { reason: unknown }): void {
    this.ended = true;
    if (error) { this.failed = true; this.failure = error.reason; }
    this.notify();
  }
}

/** Synthesize as text arrives, with bounded lookahead and ordered, cancellable output. */
export async function* streamSpeech(
  source: AsyncIterable<string>,
  options: StreamSpeechOptions,
): AsyncGenerator<SpeechChunk> {
  const capacity = positiveInteger(options.maxPendingSentences ?? 2, "maxPendingSentences", 16);
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal;
  const queue = new BoundedQueue<string>(capacity, signal);
  const iterator = source[Symbol.asyncIterator]();
  async function* input(): AsyncGenerator<string> {
    while (true) {
      const next = await abortable(Promise.resolve(iterator.next()), signal);
      if (next.done) return;
      yield next.value;
    }
  }
  const producer = (async () => {
    try {
      for await (const sentence of segmentText(input(), options)) await queue.push(sentence);
      queue.finish();
    } catch (reason) {
      queue.finish({ reason });
    }
  })();
  try {
    let index = 0;
    while (true) {
      const text = await queue.shift();
      if (text === undefined) break;
      const started = performance.now();
      const audio = await abortable(options.synthesizer.synthesize(text, { signal }), signal);
      signal.throwIfAborted();
      yield { ...audio, text, index: index++, synthesisMs: performance.now() - started };
    }
  } finally {
    lifetime.abort();
    // A third-party source may ignore cancellation; never wait indefinitely for its return().
    void Promise.resolve(iterator.return?.()).catch(() => {});
    await producer;
  }
}
