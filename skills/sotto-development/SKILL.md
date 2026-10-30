---
name: sotto-development
description: Develops or debugs the Sotto voice-turn repo itself (TypeScript turn pipeline, OpenAI-compatible adapter, Python speech runtime). Load when changing source, docs, skills, or model/runtime config in this repo. Not for merely speaking with an agent using the agent-voice prompt policy.
---

Work in the Sotto repo: a model-agnostic TypeScript voice-turn pipeline plus an
optional Python speech runtime. Keep changes small and framework-neutral,
because downstream hosts bring their own models and players.

## Boundaries

- Own nothing outside this repo: no host microphone, playback, transport, or
  deployment work here.
- Never add an agent framework, provider SDK, or runtime dependency to the
  TypeScript core; new backends arrive as port adapters.
- Do not weaken bearer auth, upload limits, admission bounds, or WAV
  validation to make a probe pass.

## Workflow

1. Read the contract first: `src/types.ts`, the file under change
   (`src/voice-turn.ts`, `src/stream.ts`, or `src/openai.ts`), then
   `docs/api.md` and `runtime/README.md` for the affected surface.
2. Keep `streamVoiceTurn` the primary API. `segmentText`, `streamSpeech`,
   and `createOpenAiSpeechSynthesizer` stay compatible beneath it.
3. Preserve semantics: full user transcript plus delta/empty-final assistant
   transcripts; `transcribing`/`thinking`/`speaking` pipeline states;
   caller-signal plus early-return cancellation with late results discarded.
4. Run from the repo root: `npm run typecheck` and `npm test`. For runtime
    route changes, also run the fake-engine suite from the repo root
   (`python -m unittest discover -s runtime -v`) without downloading models.
5. Update `docs/api.md` and `README.md` with behavior, default, or limit
   changes; keep measured latency figures as single-probe references.

## Read-when table

| Before | Read |
| --- | --- |
| Changing public API or ports | `src/index.ts`, `docs/api.md` |
| Changing segmentation or synthesis flow | `src/stream.ts`, `src/stream.test.ts` |
| Changing the HTTP adapter | `src/openai.ts`, `src/openai.test.ts` |
| Changing routes, auth, or limits | `runtime/server.py`, `runtime/README.md` |
| Changing model choice or claims | `docs/models.md` |
| Writing spoken-answer behavior | `skills/agent-voice/SKILL.md`, not this skill |
