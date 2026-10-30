# Sotto engineering

## Library boundaries
- Keep the TypeScript core framework-neutral and free of runtime dependencies. Hosts supply recognition, model response and synthesis ports; Pi, provider credentials, microphone consent, transport and playback belong to applications.
- Read `src/types.ts` and `docs/api.md` before changing public contracts. Preserve the lower-level streaming APIs alongside `streamVoiceTurn`.
- Preserve cancellation on both caller abort and early consumer return. Late provider results must not publish audio or final transcript markers for a cancelled turn.
- Keep speech claims precise: current output streams complete sentence WAVs, not native audio tokens; a `speaking` state means a chunk is ready, not physically playing.

## Prompts and documentation
- Edit canonical prompt bodies in `skills/agent-voice/SKILL.md` and `skills/turn-injection/SKILL.md`, not generated TypeScript. `scripts/build-skills.mjs` creates their dependency-free exports at build time.
- Keep `skills/sotto-development/SKILL.md` aimed at agents integrating Sotto into host applications. Contributor guidance belongs here, not in that integration skill.
- Keep the full startup voice policy separate from the tiny per-request reminder. Skills are guidance, not automatically installed harness hooks or permission grants.

## Checks and runtime
- Run `npm run typecheck && npm test` from the repository root for TypeScript changes. Use `npm pack --dry-run --json` when changing exports or packaged skills; exclude tests, credentials and model assets.
- For Python runtime changes, run `python -m unittest discover -s runtime -v` from the repository root. Read `runtime/README.md` before changing engine configuration or routes.
- Preserve runtime authentication, input/admission limits and WAV validation. Keep optional model weights and native-runtime licenses distinct from the MIT TypeScript library; consult `docs/models.md` for model claims.
