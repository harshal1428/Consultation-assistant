import type {
  Command,
  Operation,
  Parameter,
  TargetRegion,
} from "../scene/transformations/types";
import { Icon } from "./Icon";
import { StatusMessage } from "./StatusMessage";
import {
  REGION_OPTIONS,
  paramKeyFor,
  parameterLabel,
  parametersForRegion,
} from "../lib/params";
import {
  confidenceLevel,
  describeCommand,
  describeRequested,
  formatParameter,
  formatTarget,
  formatUnit,
  statusMeta,
} from "../lib/format";

interface InstructionCardProps {
  command: Command;
  index: number;
  isEditing: boolean;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onPatch: (patch: Partial<Command>) => void;
  onRemove: () => void;
}

const EDIT_OPERATIONS: { value: Operation; label: string }[] = [
  { value: "increase", label: "Increase (+)" },
  { value: "decrease", label: "Decrease (−)" },
  { value: "narrow", label: "Narrow (− width)" },
  { value: "widen", label: "Widen (+ width)" },
  { value: "rotate", label: "Rotate" },
];

export function InstructionCard({
  command,
  index,
  isEditing,
  onStartEdit,
  onSaveEdit,
  onPatch,
  onRemove,
}: InstructionCardProps) {
  const meta = statusMeta(command.status);
  const valueMissing = command.value === null;
  const confidence = confidenceLevel(command.confidence);
  const requested = describeRequested(command);

  const statusVariant =
    meta.tone === "warning"
      ? "warning"
      : meta.tone === "error"
        ? "error"
        : "info";

  // Saving an edit that resolves a previously unresolved instruction (a region
  // or parameter was supplied) promotes it to "ok" so it can be applied. This
  // never silently changes the magnitude — only explicit user edits count.
  const saveEdits = () => {
    const resolvable =
      command.value !== null &&
      paramKeyFor(command.target, command.parameter) !== null;
    if (resolvable && (command.status === "needs_clarification" || command.status === "unsupported")) {
      onPatch({ status: "ok", adjusted_value: null, reason: null });
    }
    onSaveEdit();
  };

  return (
    <li className={`instruction-card instruction-card--${meta.tone}`}>
      <div className="instruction-card__head">
        <span className="instruction-card__index">
          {command.source === "manual" ? (
            <Icon name="sliders" size={14} />
          ) : (
            <Icon name="sparkle" size={14} />
          )}
          <span>Instruction {index + 1}</span>
        </span>
        <span className={`chip chip--${meta.tone}`}>{meta.label}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={onRemove}
          aria-label={`Remove instruction ${index + 1}`}
          title="Remove from this change set"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <blockquote className="intent-review__quote">“{command.original_text}”</blockquote>

      <dl className="intent-review__grid">
        <div className="intent-review__row">
          <dt>Region</dt>
          <dd>
            {isEditing ? (
              <select
                className="select select--sm"
                aria-label="Region"
                value={command.target ?? ""}
                onChange={(e) => {
                  const region = e.target.value as TargetRegion;
                  const options = parametersForRegion(region);
                  const parameter =
                    command.parameter && options.includes(command.parameter)
                      ? command.parameter
                      : options[0] ?? null;
                  onPatch({ target: region, parameter });
                }}
              >
                {command.target === null ? <option value="">Select region…</option> : null}
                {REGION_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : command.target === null ? (
              <span className="value-warn">
                <Icon name="alertTriangle" size={14} /> Not recognised
              </span>
            ) : (
              formatTarget(command.target)
            )}
          </dd>
        </div>

        <div className="intent-review__row">
          <dt>Parameter</dt>
          <dd>
            {isEditing ? (
              <select
                className="select select--sm"
                aria-label="Parameter"
                value={command.parameter ?? ""}
                onChange={(e) => onPatch({ parameter: e.target.value as Parameter })}
              >
                {command.parameter === null ? <option value="">Select…</option> : null}
                {parametersForRegion(command.target ?? "nasal_bridge").map((p) => (
                  <option key={p} value={p}>
                    {parameterLabel(p)}
                  </option>
                ))}
              </select>
            ) : (
              formatParameter(command.parameter)
            )}
          </dd>
        </div>

        <div className="intent-review__row">
          <dt>Action</dt>
          <dd>{command.operation ?? "—"}</dd>
        </div>

        <div className="intent-review__row">
          <dt>Proposed change</dt>
          <dd>
            {isEditing ? (
              <div className="edit-inline">
                <select
                  className="select select--sm"
                  aria-label="Operation"
                  value={command.operation ?? "increase"}
                  onChange={(e) => onPatch({ operation: e.target.value as Operation })}
                >
                  {EDIT_OPERATIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  className="input input--sm"
                  type="number"
                  min="0"
                  aria-label="Value"
                  value={command.value ?? 0}
                  onChange={(e) => onPatch({ value: Math.abs(parseFloat(e.target.value) || 0) })}
                />
                <select
                  className="select select--sm"
                  aria-label="Unit"
                  value={command.unit ?? "mm"}
                  onChange={(e) => onPatch({ unit: e.target.value as Command["unit"] })}
                >
                  <option value="mm">mm</option>
                  <option value="degrees">degrees</option>
                </select>
              </div>
            ) : valueMissing ? (
              <span className="value-warn">
                <Icon name="alertTriangle" size={14} /> Not specified
              </span>
            ) : (
              <span className="value-strong">
                {describeCommand(command)}
                {requested ? (
                  <span className="intent-review__muted"> (requested {requested})</span>
                ) : null}
              </span>
            )}
          </dd>
        </div>

        <div className="intent-review__row">
          <dt>Parser confidence</dt>
          <dd>
            <span className={`confidence confidence--${confidence.tone}`}>
              {confidence.label}
            </span>
            <span className="intent-review__muted">
              {" "}
              ({command.parser === "llm" ? "language model" : "rules"})
            </span>
          </dd>
        </div>
      </dl>

      {command.reason && command.status !== "ok" ? (
        <StatusMessage variant={statusVariant} title={meta.label}>
          {command.reason}
        </StatusMessage>
      ) : null}

      {command.status === "ok" && command.reason ? (
        <StatusMessage variant="info" title="Note">
          {command.reason}
        </StatusMessage>
      ) : null}

      {command.status === "needs_clarification" && !isEditing ? (
        <div className="clarify">
          <p className="clarify__prompt">
            <Icon name="alertTriangle" size={15} /> Resolve this instruction before
            it can be applied:
          </p>
          <div className="clarify__choices">
            {command.adjusted_value !== null ? (
              <button
                type="button"
                className="btn btn--soft"
                onClick={() =>
                  onPatch({ value: command.adjusted_value, adjusted_value: null, status: "ok", reason: null })
                }
              >
                Accept adjusted {command.adjusted_value} {formatUnit(command.unit)}
              </button>
            ) : null}
            {valueMissing
              ? ([1, 2] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="btn btn--soft"
                    onClick={() => onPatch({ value: v, unit: command.unit ?? "mm", status: "ok", reason: null })}
                  >
                    {v} {formatUnit(command.unit ?? "mm")}
                  </button>
                ))
              : null}
            <button type="button" className="btn btn--soft" onClick={onStartEdit}>
              Custom value
            </button>
          </div>
        </div>
      ) : null}

      <div className="intent-review__actions">
        {isEditing ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={saveEdits}>
            <Icon name="check" size={15} /> Save edits
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onStartEdit}
            disabled={command.target === null && command.parameter === null}
          >
            Edit
          </button>
        )}
      </div>
    </li>
  );
}
