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
  /** Maximum sentences queued ahead of active synthesis. Default 2. */
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

/** Text or a complete recording supplied by the host, never implicit microphone capture. */
export type VoiceInput =
  | { type: "text"; text: string }
  | { type: "audio"; data: Uint8Array; mimeType: string };

export interface VoiceResponder {
  respond(text: string, options: { signal: AbortSignal }): AsyncIterable<string>;
}

export interface SpeechRecognizer {
  transcribe(audio: Uint8Array, mimeType: string, signal: AbortSignal): Promise<string>;
}

export type VoiceTurnPhase = "transcribing" | "thinking" | "speaking";

export interface VoiceTranscript {
  role: "user" | "assistant";
  /** Full user text, assistant delta, or an empty final assistant marker. */
  text: string;
  final: boolean;
}

export interface VoiceTurnOptions extends StreamSpeechOptions {
  responder: VoiceResponder;
  /** Required only for audio input. */
  recognizer?: SpeechRecognizer;
  onTranscript?: (transcript: VoiceTranscript) => void;
  /** Speaking means a chunk is ready, not that the host has played it. */
  onState?: (phase: VoiceTurnPhase) => void;
}
