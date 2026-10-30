# VoiceSurg project brief

VoiceSurg is an existing web-based rhinoplasty consultation simulator built with
React 18 + TypeScript + Vite + three.js on the frontend and FastAPI + Python on
the backend. A surgeon speaks during a consultation; the system turns speech into
structured numeric simulation parameters for a 3D nose/face model.

In the live surgery phase only changes the surgeon has **decided** may be
applied. Hedged or hypothetical speech ("we may reduce the bridge 2 mm", "we can
check alar width by increasing 2 mm", "what if", "maybe", "let's try") is a
**proposal**, never applied directly. Questions, view commands, and general
conversation are never applied. A later milestone builds that commitment gate.

This session builds two things:

1. **Milestone 1 — the measuring stick.** A documented, validated gold set, a
   deterministic stratified dev/test split, and an evaluation harness that runs
   the real current parse pipeline and the real TypeScript auto-apply decision.
   The headline metric is `false_commit_rate`: the fraction of non-command gold
   rows the system would apply in Live mode. Baseline metrics and a ratchet
   regression test make future changes measurable.
2. **Milestone 3 — the voice input layer.** A server-side faster-whisper
   backend with streaming Silero-compatible VAD, hallucination guards,
   deterministic number/unit normalization, and lexicon-based correction. A
   `/ws/voice` WebSocket accepts push-to-talk PCM16 audio. The frontend captures
   microphone audio with an AudioWorklet, streams it, shows raw vs cleaned
   transcripts, and sends the cleaned text through the existing parse endpoint
   with `source: "voice"`.

Temporary safety: `VOICE_AUTOAPPLY` defaults to false. While false, voice
results in Live mode go through the existing review/confirmation path rather
than auto-applying. The legacy browser Web Speech path remains available behind
`VITE_VOICE_MODE=legacy`; the server path is the default.

The work must not change the deformation engine, face reconstruction, registry,
parser logic, or LLM fallback, and must not add bundled face or head geometry,
model weights, audio files, or secrets.
