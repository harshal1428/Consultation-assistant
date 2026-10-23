import { useState } from "react";
import type { ModelState, ParamKey } from "../scene/transformations/types";
import { SIMULATED_PARAM_KEYS } from "../scene/transformations/types";
import { PARAM_GROUPS, descriptorsForGroup } from "../lib/params";
import type { ParamGroup } from "../lib/params";
import { ParameterControl } from "./ParameterControl";
import { Icon } from "./Icon";

interface ParameterPanelProps {
  modelState: ModelState;
  onChange: (key: ParamKey, value: number) => void;
  onReset: (key: ParamKey) => void;
}

export function ParameterPanel({
  modelState,
  onChange,
  onReset,
}: ParameterPanelProps) {
  const [openGroup, setOpenGroup] = useState<ParamGroup | null>(null);

  const groups = PARAM_GROUPS.map((group) => ({
    ...group,
    descriptors: descriptorsForGroup(group.id).filter(
      (d) => d.manual && SIMULATED_PARAM_KEYS.includes(d.key),
    ),
  })).filter((group) => group.descriptors.length > 0);

  return (
    <section className="panel parameters" aria-label="Simulation parameters">
      <div className="panel__header">
        <div>
          <h2 className="panel__title">
            <Icon name="sliders" size={16} /> Simulation Parameters
          </h2>
          <p className="panel__subtitle">
            Select a facial region to view and adjust its parameters
          </p>
        </div>
      </div>

      <div className="param-regions">
        {groups.map((group) => {
          const open = openGroup === group.id;
          const changedCount = group.descriptors.filter(
            (descriptor) => modelState[descriptor.key] !== 0,
          ).length;
          return (
            <div
              key={group.id}
              className={`param-region${open ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="param-region__button"
                aria-expanded={open}
                aria-controls={`param-region-${group.id}`}
                onClick={() => setOpenGroup(open ? null : group.id)}
              >
                <span className="param-region__title">
                  {group.label}
                  {changedCount > 0 ? (
                    <span
                      className="param-region__badge"
                      title={`${changedCount} adjusted this session`}
                    >
                      {changedCount}
                    </span>
                  ) : null}
                </span>
                <Icon
                  name="chevron"
                  size={16}
                  className="param-region__chevron"
                />
              </button>

              <p className="param-region__hint">{group.description}</p>

              {open ? (
                <div
                  id={`param-region-${group.id}`}
                  className="param-group__controls"
                >
                  {group.descriptors.map((descriptor) => {
                    const value = modelState[descriptor.key];
                    return (
                      <ParameterControl
                        key={descriptor.key}
                        descriptor={descriptor}
                        value={value}
                        changed={value !== 0}
                        onChange={(v) => onChange(descriptor.key, v)}
                        onReset={() => onReset(descriptor.key)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="panel__subtitle">
        Applied changes and manual adjustments
      </p>
    </section>
  );
}
