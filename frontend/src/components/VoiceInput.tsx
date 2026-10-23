import type { ConsultationPhase } from "../scene/transformations/types";
import { Icon } from "./Icon";

interface VoiceInputProps {
  isListening: boolean;
  supported: boolean;
  phase: ConsultationPhase;
  language: string;
  onLanguageChange: (lang: string) => void;
  onToggle: () => void;
}

const LANGUAGES = [
  { value: "en-US", label: "English (en-US)" },
  { value: "hi-IN", label: "Hindi (hi-IN)" },
  { value: "mr-IN", label: "Marathi (mr-IN)" },
];

const PHASE_META: Record<
  ConsultationPhase,
  { label: string; tone: "neutral" | "accent" | "info" | "warning" | "error" }
> = {
  ready: { label: "Ready to listen", tone: "neutral" },
  listening: { label: "Listening…", tone: "accent" },
  transcribed: { label: "Transcription captured", tone: "info" },
  processing: { label: "Processing command…", tone: "info" },
  review: { label: "Awaiting confirmation", tone: "warning" },
  error: { label: "Attention needed", tone: "error" },
};

export function VoiceInput({
  isListening,
  supported,
  phase,
  language,
  onLanguageChange,
  onToggle,
}: VoiceInputProps) {
  const meta = PHASE_META[phase];

  return (
    <div className="voice-input">
      <button
        type="button"
        className={`mic-button ${isListening ? "is-listening" : ""}`}
        aria-pressed={isListening}
        aria-label={isListening ? "Stop listening" : "Start listening"}
        onClick={onToggle}
        disabled={!supported}
      >
        <span className="mic-button__ring" aria-hidden="true" />
        <Icon name={isListening ? "stop" : "mic"} size={26} />
      </button>

      <div className="voice-input__side">
        <span className={`phase-chip phase-chip--${meta.tone}`}>
          {isListening ? <span className="phase-chip__pulse" aria-hidden="true" /> : null}
          {meta.label}
        </span>

        <label className="field field--inline">
          <span className="field__label">
            <Icon name="globe" size={14} /> Recognised language
          </span>
          <select
            className="select"
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            disabled={isListening}
          >
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
