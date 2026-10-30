/**
 * Voice input configuration.
 *
 * `server` is the default: raw microphone audio is streamed to the backend
 * `/ws/voice` endpoint, which runs VAD + local ASR. `legacy` keeps the browser
 * Web Speech API path available behind an explicit flag.
 *
 * Voice results are *not* applied in Live mode by default. They open the normal
 * proposal review path instead; set `VITE_VOICE_AUTOAPPLY=true` to restore the
 * previous auto-apply behaviour for live voice. Typed live instructions keep
 * auto-applying.
 */
export type VoiceMode = "server" | "legacy";

const rawMode = String(import.meta.env.VITE_VOICE_MODE ?? "server").toLowerCase();

export const VOICE_MODE: VoiceMode =
  rawMode === "legacy" || rawMode === "browser" ? "legacy" : "server";

export const VOICE_AUTOAPPLY =
  String(import.meta.env.VITE_VOICE_AUTOAPPLY ?? "false").toLowerCase() === "true";

/** Dev recorder is opt-in and never enabled in a production build. */
export const VOICE_DEV_TOOLS =
  Boolean(import.meta.env.DEV) &&
  String(import.meta.env.VITE_DEV_TOOLS ?? "false").toLowerCase() === "true";
