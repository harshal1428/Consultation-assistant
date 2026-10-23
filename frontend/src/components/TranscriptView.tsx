import type { ConsultationPhase } from "../scene/transformations/types";
import { Icon } from "./Icon";

interface TranscriptViewProps {
  transcript: string;
  phase: ConsultationPhase;
}

export function TranscriptView({ transcript, phase }: TranscriptViewProps) {
  const isEmpty = !transcript;
  const waiting = isEmpty && (phase === "ready" || phase === "listening");

  return (
    <div>
      <div className="field__label field__label--block">
        <Icon name="mic" size={14} /> Recognised instruction
      </div>
      <div
        className={`transcript ${isEmpty ? "transcript--empty" : ""} ${
          phase === "listening" ? "transcript--live" : ""
        }`}
        aria-live="polite"
      >
        {transcript ? (
          <p className="transcript__text">“{transcript}”</p>
        ) : waiting ? (
          <p className="transcript__placeholder">
            {phase === "listening"
              ? "Listening — please speak your instruction."
              : "No instruction yet. Use the microphone or type a command below."}
          </p>
        ) : (
          <p className="transcript__placeholder">No instruction captured.</p>
        )}
      </div>
    </div>
  );
}
