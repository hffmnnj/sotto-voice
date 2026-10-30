/** A complete independently playable audio segment. */
export interface SpeechAudio {
  data: Uint8Array;
  mimeType: "audio/wav";
}

export interface SpeechSynthesizer {
  synthesize(text: string, options: { signal: AbortSignal }): Promise<SpeechAudio>;
}

export interface SpeechChunk extends SpeechAudio {
  index: number;
  text: string;
  /** Milliseconds spent synthesizing this chunk, excluding queue time. */
  synthesisMs: number;
}

export interface SegmentationOptions {
  /** Bound an unpunctuated utterance. Default 240 characters. */
  maxCharacters?: number;
  /** Allow a comma/semicolon clause after this many characters. Default 80. */
  clauseCharacters?: number;
}

export interface StreamSpeechOptions extends SegmentationOptions {
  synthesizer: SpeechSynthesizer;
  signal?: AbortSignal;
  /** Maximum synthesized or queued sentences ahead of playback. Default 2. */
  maxPendingSentences?: number;
}

export interface OpenAiSpeechOptions {
  baseUrl: string;
  model?: string;
  voice?: string;
  apiKey?: string;
  timeoutMs?: number;
  maxAudioBytes?: number;
}
