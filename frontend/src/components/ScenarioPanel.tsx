import { useState } from "react";
import type { FormEvent } from "react";
import type { Scenario } from "../scene/session/types";
import type { ModelState } from "../scene/transformations/types";
import { PARAM_DESCRIPTORS } from "../lib/params";
import type { ParamKey } from "../scene/transformations/types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Icon } from "./Icon";

interface ScenarioPanelProps {
  scenarios: Scenario[];
  selectedId: string | null;
  modelState: ModelState;
  disabled: boolean;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onLoad: (id: string) => void;
  onSelect: (id: string) => void;
}

const SUMMARY_KEYS: ParamKey[] = [
  "bridgeHeight",
  "bridgeWidth",
  "tipProjection",
  "tipHeight",
  "tipRotation",
  "alarWidth",
];

function summarize(state: ModelState): string {
  const parts = SUMMARY_KEYS.filter((k) => state[k] !== 0).map((k) => {
    const d = PARAM_DESCRIPTORS[k];
    const unit = d.unit === "degrees" ? "°" : "mm";
    const sign = state[k] > 0 ? "+" : "";
    return `${d.shortLabel} ${sign}${state[k]}${unit}`;
  });
  return parts.length === 0 ? "Baseline (no changes)" : parts.join(" · ");
}

export function ScenarioPanel({
  scenarios,
  selectedId,
  modelState,
  disabled,
  onSave,
  onRename,
  onDelete,
  onLoad,
  onSelect,
}: ScenarioPanelProps) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Scenario | null>(null);

  const submitSave = (e: FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    onSave(name.trim() || `Scenario ${scenarios.length + 1}`);
    setName("");
  };

  const startEdit = (scenario: Scenario) => {
    setEditingId(scenario.id);
    setEditName(scenario.name);
  };

  const commitEdit = () => {
    if (editingId && editName.trim()) onRename(editingId, editName.trim());
    setEditingId(null);
    setEditName("");
  };

  return (
    <section className="panel scenarios" aria-label="Simulation scenarios">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="folder" size={16} /> Scenarios
          </h2>
          <p className="panel__subtitle">
            {scenarios.length === 0
              ? "No saved scenarios · in-memory only"
              : `${scenarios.length} saved · in-memory only`}
          </p>
        </div>
      </div>

      <form className="scenario-save" onSubmit={submitSave}>
        <label className="field__label field__label--block" htmlFor="scenario-name">
          <Icon name="download" size={14} /> Save current state as scenario
        </label>
        <div className="scenario-save__row">
          <input
            id="scenario-name"
            className="input"
            type="text"
            placeholder="e.g. Conservative tip lift"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={disabled}
            autoComplete="off"
          />
          <button type="submit" className="btn btn--primary" disabled={disabled}>
            <Icon name="download" size={16} /> Save
          </button>
        </div>
        <p className="scenario-save__hint">
          Current working values: {summarize(modelState)}
        </p>
      </form>

      {scenarios.length === 0 ? (
        <div className="empty-state">
          <Icon name="folder" size={22} />
          <p>Saved scenarios let you compare alternatives.</p>
          <span>Scenarios are stored in memory and cleared on reload.</span>
        </div>
      ) : (
        <ul className="scenario-list">
          {scenarios.map((scenario) => {
            const isSelected = scenario.id === selectedId;
            const isEditing = scenario.id === editingId;
            return (
              <li
                key={scenario.id}
                className={`scenario-item ${isSelected ? "is-selected" : ""}`}
              >
                {isEditing ? (
                  <div className="scenario-item__edit">
                    <input
                      className="input input--sm"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label="Scenario name"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="btn btn--primary btn--sm"
                      onClick={commitEdit}
                    >
                      <Icon name="check" size={14} /> Save
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="scenario-item__head">
                      <button
                        type="button"
                        className="scenario-item__select"
                        aria-pressed={isSelected}
                        onClick={() => onSelect(scenario.id)}
                        title="Mark as the final selected scenario"
                      >
                        <Icon name="check" size={14} />
                        {scenario.name}
                      </button>
                      <time
                        className="scenario-item__time"
                        dateTime={new Date(scenario.createdAt).toISOString()}
                      >
                        {new Date(scenario.createdAt).toLocaleTimeString()}
                      </time>
                    </div>
                    <p className="scenario-item__summary">{summarize(scenario.state)}</p>
                    {scenario.notes ? (
                      <p className="scenario-item__notes">{scenario.notes}</p>
                    ) : null}
                    <div className="scenario-item__actions">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => onLoad(scenario.id)}
                      >
                        <Icon name="arrowRight" size={14} /> Load
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => startEdit(scenario)}
                      >
                        <Icon name="edit" size={14} /> Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm btn--danger-ghost"
                        onClick={() => setPendingDelete(scenario)}
                      >
                        <Icon name="trash" size={14} /> Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete scenario"
        danger
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      >
        Delete “{pendingDelete?.name}”? This only removes the saved snapshot from
        this in-memory session and cannot be undone.
      </ConfirmDialog>
    </section>
  );
}
