# DECISIONS.md

## Voice layer hardening (2026-10-29)

- **Proposal vs command:** In live mode, hedged/proposal phrases (e.g., "we may...", "could we...", "let's check...", "shall we try...") must not be auto-applied. We treat them as `proposal`/`question` and never commit them. The live evaluator (`evaluateLiveInstruction`) must reject instructions that originate from proposal/hedge phrasing by requiring a clear imperative/commit intent.
- **Hedged language detection:** Add backend-side detection of hedges ("we may", "we could", "maybe", "perhaps", "let's", "shall we", "could we", "can we check", "we might") and mark as proposal/question rather than command. In live mode, proposals never auto-apply.
- **Chatter/ignored:** Casual talk (greetings, small talk) must be ignored (label `ignored`) and never committed.
- **False-commit rate:** Define false-commit as any utterance labeled `command` that is committed in live mode OR any hedged/ignored/question utterance that is committed. The gold set eval will compute and fail if > 0.0.
- **Multi-turn:** Support conversation_id/turn_index in gold set; "yes do that" / "go ahead" confirm a prior proposal only if context exists.
- **Source marking:** All gold set rows marked `source=synthetic`.
- **Preserve tests:** Keep all existing 234 frontend + 36 backend tests green; do not edit tests.
- **Scope:** Voice only. No changes to mesh/deformation/photo reconstruction.
- **Verification:** After each milestone, run all tests.
