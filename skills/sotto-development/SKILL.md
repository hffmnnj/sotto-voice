---
name: sotto-development
description: Integrates Sotto voice turns into a host application using an agent harness. Load when wiring a recognizer, responder, or synthesizer, or when configuring per-turn voice reminders. For developers using agents to add Sotto to their own app, not for Sotto repo contributors.
---

Integrate Sotto into your application: connect the three ports, apply the
voice prompt policy, and own the surrounding host duties.

## Connect the ports

Read `docs/api.md` and the exported types (`VoiceResponder`,
`SpeechRecognizer`, `SpeechSynthesizer`, `VoiceTurnOptions`) first. Then bring
your own implementations:

- `VoiceResponder.respond(text, { signal })` — your text model as streamed
  string deltas. Honor the abort signal.
- `SpeechRecognizer.transcribe(audio, mimeType, signal)` — your
  speech-to-text, needed for audio turns only.
- `SpeechSynthesizer` — your speech engine, or
  `createOpenAiSpeechSynthesizer({ baseUrl, apiKey, voice })` for the
  loopback runtime. Match `model`/`voice` to the engine.

Pass them to `streamVoiceTurn(input, options)` with your `signal`,
`onTranscript`, and `onState` handlers, and play each yielded WAV chunk on
your own player with a bounded queue.

## Apply the voice policy

`AGENT_VOICE_INSTRUCTIONS` is the full startup policy: append it once to your
model's system instructions. `TURN_INJECTION_INSTRUCTIONS` is the tiny
recurring reminder: inject it as trusted host context on every model request,
without persisting duplicates into conversation history and without speaking
it aloud. Skills are discovered guidance, not automatic hooks: installing a
skill alone does not implement injection; your host code must do it.

## Own the host duties

- Authentication, microphone consent and capture, voice activity detection,
  audio focus, and playback scheduling stay with the host.
- Tool permissions and turn identity stay with the host: decide when to speak
  an acknowledgment while a tool runs, and discard stale audio on replacement
  turns using your own turn IDs.
- Cancel stale turns: abort the turn's signal on interruption, dismiss, or a
  replacement turn. Sotto stops consuming and discards late audio.
- Verify with a real host round trip: text in, streamed reply, ordered WAV
  chunks out, interruption aborts cleanly.

## Read-when table

| Before | Read |
| --- | --- |
| Wiring ports or options | `docs/api.md`, packaged declarations in `dist/index.d.ts` and `dist/types.d.ts` |
| Configuring voice prompts | `skills/agent-voice/SKILL.md`, `skills/turn-injection/SKILL.md` |
| Choosing synthesis setup | `docs/models.md`, `runtime/README.md` |
