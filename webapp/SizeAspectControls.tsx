import React from "react";
import { SliderField } from "./SliderField";

export type SizeAspectValue = {
  scaleX: number;
  scaleY: number;
  aspectLock: boolean;
};

/**
 * One size/aspect editor for whichever room or picture is currently selected.
 * Lock on → both axes stay proportional; lock off → independent sliders.
 */
export const SizeAspectControls: React.FC<{
  title: string;
  value: SizeAspectValue;
  onChange: (next: SizeAspectValue) => void;
  min?: number;
  max?: number;
  step?: number;
}> = ({ title, value, onChange, min = 0.2, max = 3, step = 0.01 }) => {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const ratio = value.scaleY === 0 ? 1 : value.scaleX / value.scaleY;

  const setScaleX = (nextX: number) => {
    const x = clamp(nextX);
    if (value.aspectLock) {
      onChange({ ...value, scaleX: x, scaleY: clamp(x / (ratio || 1)) });
    } else {
      onChange({ ...value, scaleX: x });
    }
  };

  const setScaleY = (nextY: number) => {
    const y = clamp(nextY);
    if (value.aspectLock) {
      onChange({ ...value, scaleY: y, scaleX: clamp(y * (ratio || 1)) });
    } else {
      onChange({ ...value, scaleY: y });
    }
  };

  return (
    <div className="size-aspect">
      <div className="size-aspect__head">
        <h3>{title}</h3>
        <button
          type="button"
          className={`size-aspect__lock${value.aspectLock ? " is-locked" : ""}`}
          title={value.aspectLock ? "Seitenverhältnis gesperrt" : "Seitenverhältnis frei"}
          onClick={() => onChange({ ...value, aspectLock: !value.aspectLock })}
        >
          {value.aspectLock ? "🔒" : "🔓"}
        </button>
      </div>
      <p className="hint">
        {value.aspectLock
          ? "Schloss zu — Breite und Höhe skalieren gemeinsam."
          : "Schloss auf — Breite und Höhe unabhängig."}
      </p>
      <SliderField size="lg" label="Breite (scaleX)" value={value.scaleX} min={min} max={max} step={step} onChange={setScaleX} />
      <SliderField size="lg" label="Höhe (scaleY)" value={value.scaleY} min={min} max={max} step={step} onChange={setScaleY} />
    </div>
  );
};
