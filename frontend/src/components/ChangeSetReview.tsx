import type { Command } from "../scene/transformations/types";
import { InstructionCard } from "./InstructionCard";
import { Icon } from "./Icon";
import { isApplicable } from "../lib/format";

interface ChangeSetReviewProps {
  commands: Command[];
  editingIndex: number | null;
  onConfirm: () => void;
  onConfirmValid: () => void;
  onRejectAll: () => void;
  onStartEdit: (index: number) => void;
  onSaveEdit: () => void;
  onPatch: (index: number, patch: Partial<Command>) => void;
  onRemove: (index: number) => void;
}

export function ChangeSetReview({
  commands,
  editingIndex,
  onConfirm,
  onConfirmValid,
  onRejectAll,
  onStartEdit,
  onSaveEdit,
  onPatch,
  onRemove,
}: ChangeSetReviewProps) {
  const applicable = commands.filter(isApplicable).length;
  const blocked = commands.length - applicable;
  const hasMultiple = commands.length > 1;
  const allApplicable = commands.length > 0 && blocked === 0;
  const showApplyValid = blocked > 0 && applicable > 0;

  return (
    <div className="intent-review">
      <div className="intent-review__header">
        <div>
          <h2 className="intent-review__title">
            <Icon name="sparkle" size={16} />{" "}
            {hasMultiple ? "Change set" : "Proposed change"}
          </h2>
          <p className="intent-review__subtitle">
            {commands.length} instruction{commands.length === 1 ? "" : "s"} parsed
            from your command. Nothing is applied until you confirm.
          </p>
        </div>
      </div>

      <ul className="instruction-list">
        {commands.map((command, index) => (
          <InstructionCard
            key={command.id}
            command={command}
            index={index}
            isEditing={editingIndex === index}
            onStartEdit={() => onStartEdit(index)}
            onSaveEdit={onSaveEdit}
            onPatch={(patch) => onPatch(index, patch)}
            onRemove={() => onRemove(index)}
          />
        ))}
      </ul>

      {blocked > 0 ? (
        <p className="intent-review__note">
          {applicable === 0
            ? "None of these instructions can be applied as parsed. Resolve or remove the invalid ones, then confirm."
            : `${applicable} of ${commands.length} can be applied. A change set is only applied in full — resolve or remove the rest, or deliberately apply just the valid subset below.`}
        </p>
      ) : null}

      <div className="intent-review__footer">
        <button type="button" className="btn btn--ghost" onClick={onRejectAll}>
          <Icon name="close" size={16} /> Reject all
        </button>
        {showApplyValid ? (
          <button type="button" className="btn btn--soft" onClick={onConfirmValid}>
            <Icon name="check" size={16} /> Apply only valid ({applicable})
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--primary"
          onClick={onConfirm}
          disabled={!allApplicable}
          title={
            allApplicable
              ? "Apply this change set"
              : "A change set is applied in full — resolve the remaining instructions first"
          }
        >
          <Icon name="check" size={16} /> Confirm &amp; simulate
          {applicable > 0 ? ` (${applicable})` : ""}
        </button>
      </div>
    </div>
  );
}
