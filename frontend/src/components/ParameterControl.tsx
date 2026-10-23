import type { ParamDescriptor } from "../lib/params";
import { Icon } from "./Icon";

interface ParameterControlProps {
  descriptor: ParamDescriptor;
  value: number;
  changed: boolean;
  onChange: (value: number) => void;
  onReset: () => void;
}

export function ParameterControl({
  descriptor,
  value,
  changed,
  onChange,
  onReset,
}: ParameterControlProps) {
  const id = `param-${descriptor.key}`;
  const unitLabel = descriptor.unit === "degrees" ? "°" : "mm";
  const displayValue = `${value > 0 ? "+" : ""}${value} ${unitLabel}`;

  return (
    <div className={`param-control ${changed ? "is-changed" : ""}`}>
      <div className="param-control__head">
        <div className="param-control__labels">
          <label htmlFor={id} className="param-control__name">
            {descriptor.label}
            {changed ? (
              <span className="param-control__changed" title="Adjusted this session">
                changed
              </span>
            ) : null}
          </label>
          <span className="param-control__hint">{descriptor.hint}</span>
        </div>
        <output htmlFor={id} className="param-control__value">
          {displayValue}
        </output>
      </div>

      <div className="param-control__row">
        <input
          id={id}
          className="range"
          type="range"
          min={descriptor.min}
          max={descriptor.max}
          step={descriptor.step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          aria-label={descriptor.label}
          aria-valuetext={displayValue}
        />
        <button
          type="button"
          className="icon-btn"
          onClick={onReset}
          disabled={value === 0}
          title={`Reset ${descriptor.shortLabel} to 0`}
          aria-label={`Reset ${descriptor.shortLabel} to 0`}
        >
          <Icon name="resetView" size={14} />
        </button>
      </div>

      <div className="param-control__range">
        <span>
          {descriptor.min}
          {unitLabel === "°" ? "°" : ""}
        </span>
        <span>
          {descriptor.max}
          {unitLabel === "°" ? "°" : ""}
        </span>
      </div>
    </div>
  );
}
