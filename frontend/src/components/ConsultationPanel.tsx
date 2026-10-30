import { useState } from "react";
import type { FormEvent } from "react";
import type { Command, ConsultationPhase } from "../scene/transformations/types";
import type { Proposal, TranscriptEntry } from "../scene/session/types";
import { VoiceInput } from "./VoiceInput";
import { TranscriptView } from "./TranscriptView";
import { ChangeSetReview } from "./ChangeSetReview";
import { TranscriptLog } from "./TranscriptLog";
import { StatusMessage } from "./StatusMessage";
import { Icon } from "./Icon";

interface ConsultationPanelProps {
  isListening: boolean;
  speechSupported: boolean;
  phase: ConsultationPhase;
  isProcessing: boolean;
  transcript: string;
  language: string;
  onLanguageChange: (lang: string) => void;
  onToggleListening: () => void;
  speechError: string;
  apiError: string;
  onDismissSpeechError: () => void;
  onDismissApiError: () => void;
  onSubmitText: (text: string) => void;
  pendingCommands: Command[];
  editingIndex: number | null;
  onConfirm: () => void;
  onConfirmValid: () => void;
  onRejectAll: () => void;
  onStartEdit: (index: number) => void;
  onSaveEdit: () => void;
  onPatch: (index: number, patch: Partial<Command>) => void;
  onRemove: (index: number) => void;
  voiceConfirmation: boolean;
  onToggleVoiceConfirmation: () => void;
  sessionActive: boolean;
  transcriptEntries: TranscriptEntry[];
  proposals: Proposal[];
}

export function ConsultationPanel({
  isListening,
  speechSupported,
  phase,
  isProcessing,
  transcript,
  language,
  onLanguageChange,
  onToggleListening,
  speechError,
  apiError,
  onDismissSpeechError,
  onDismissApiError,
  onSubmitText,
  pendingCommands,
  editingIndex,
  onConfirm,
  onConfirmValid,
  onRejectAll,
  onStartEdit,
  onSaveEdit,
  onPatch,
  onRemove,
  voiceConfirmation,
  onToggleVoiceConfirmation,
  sessionActive,
  transcriptEntries,
  proposals,
}: ConsultationPanelProps) {
  const [typedText, setTypedText] = useState("");
  const typedDisabled = isListening || isProcessing || !sessionActive;

  const submitTyped = (e: FormEvent) => {
    e.preventDefault();
    const text = typedText.trim();
    if (!text || typedDisabled) return;
    onSubmitText(text);
    setTypedText("");
  };

  return (
    <section className="panel consultation" aria-label="Surgeon consultation">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="mic" size={16} /> Surgeon Consultation
          </h2>
          <p className="panel__subtitle">
            Speak or type a natural-language instruction
          </p>
        </div>
      </div>

      {!sessionActive ? (
        <StatusMessage variant="info" title="Consultation ended">
          This consultation has ended. Start a new consultation to capture more
          instructions; the timeline and scenarios remain visible.
        </StatusMessage>
      ) : null}

      <VoiceInput
        isListening={isListening}
        supported={speechSupported}
        phase={phase}
        language={language}
        onLanguageChange={onLanguageChange}
        onToggle={onToggleListening}
      />

      {!speechSupported ? (
        <StatusMessage variant="info" title="Voice input unavailable">
          This browser cannot capture microphone audio. You can still use the
          typed command field below.
        </StatusMessage>
      ) : null}

      {speechError ? (
        <StatusMessage variant="error" title="Microphone" onDismiss={onDismissSpeechError}>
          {speechError}
        </StatusMessage>
      ) : null}

      {apiError ? (
        <StatusMessage variant="error" title="Parsing service" onDismiss={onDismissApiError}>
          {apiError}
        </StatusMessage>
      ) : null}

      <TranscriptView transcript={transcript} phase={phase} />

      <form className="typed-command" onSubmit={submitTyped}>
        <label className="field__label field__label--block" htmlFor="typed-command">
          <Icon name="send" size={14} /> Type a command
        </label>
        <div className="typed-command__row">
          <input
            id="typed-command"
            className="input"
            type="text"
            placeholder="e.g. Reduce the bridge by 2 millimetres"
            value={typedText}
            onChange={(e) => setTypedText(e.target.value)}
            disabled={typedDisabled}
            autoComplete="off"
          />
          <button
            type="submit"
            className="btn btn--primary"
            disabled={typedDisabled || typedText.trim().length === 0}
          >
            <Icon name="send" size={16} />
            Send
          </button>
        </div>
      </form>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={voiceConfirmation}
          onChange={onToggleVoiceConfirmation}
        />
        <span>Spoken confirmation after applying a change</span>
      </label>

      {pendingCommands.length > 0 ? (
        <ChangeSetReview
          commands={pendingCommands}
          editingIndex={editingIndex}
          onConfirm={onConfirm}
          onConfirmValid={onConfirmValid}
          onRejectAll={onRejectAll}
          onStartEdit={onStartEdit}
          onSaveEdit={onSaveEdit}
          onPatch={onPatch}
          onRemove={onRemove}
        />
      ) : null}

      <section className="transcript-section" aria-label="Transcript log">
        <h3 className="transcript-section__title">
          <Icon name="history" size={15} /> Transcript log
        </h3>
        <TranscriptLog entries={transcriptEntries} proposals={proposals} />
      </section>
    </section>
  );
}
