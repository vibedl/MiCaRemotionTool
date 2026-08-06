import React from "react";

/**
 * A labeled range slider with a live numeric readout, plus two nudge buttons
 * ("−"/"+") flanking the track for precise one-step adjustments — dragging a
 * thin native `<input type="range">` thumb is fiddly, especially for small
 * ranges, so the buttons give a reliable fallback for fine-tuning.
 *
 * `size="lg"` renders a taller track/thumb — used for the single "currently
 * selected keyframe" editor panel, where there's room for exactly one slider
 * per row instead of cramming many into a table cell.
 */
export const SliderField: React.FC<{
  label?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  decimals?: number;
  size?: "sm" | "lg";
  disabled?: boolean;
}> = ({ label, value, min, max, step, onChange, decimals = 2, size = "sm", disabled = false }) => {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const round = (v: number) => Math.round(v / step) * step;
  return (
    <div className={`slider-field slider-field--${size}${disabled ? " is-disabled" : ""}`}>
      {label && <span className="slider-field__label">{label}</span>}
      <div className="slider-field__row">
        <button
          type="button"
          className="slider-field__nudge"
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(round(value - step)))}
        >
          −
        </button>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button
          type="button"
          className="slider-field__nudge"
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(round(value + step)))}
        >
          +
        </button>
        <span className="slider-field__value">{value.toFixed(decimals)}</span>
      </div>
    </div>
  );
};
