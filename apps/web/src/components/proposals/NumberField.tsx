"use client";

// A text field for a number that may be unknown. It keeps what is typed ("1.", "$12") while the
// architect types, passes on the number once it reads as one, and empty means unknown (null).
import { useState } from "react";

/** "12", "1,250" → numbers; "" → null; anything else → undefined (not a number yet). */
function parse(text: string): number | null | undefined {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === ".") return undefined;
  return Number(cleaned);
}

export function NumberField({
  id,
  value,
  onChange,
  max,
  money = false,
  label,
  describedBy,
  className = "",
}: {
  id?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  max: number;
  /** Shown with two decimals once the field is left. */
  money?: boolean;
  /** The accessible name, when no <label> points at the field. */
  label?: string;
  describedBy?: string;
  className?: string;
}) {
  const show = (n: number | null) =>
    n === null ? "" : money ? n.toFixed(2) : String(Math.round(n * 1000) / 1000);
  const [text, setText] = useState(() => show(value));
  const [shown, setShown] = useState(value);
  // A value changed from outside (a line added, a catalog price) replaces what is in the field.
  if (value !== shown) {
    setShown(value);
    setText(show(value));
  }
  const parsed = parse(text);
  const invalid = parsed === undefined || (parsed !== null && parsed > max);

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={text}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (n === undefined || (n !== null && n > max)) return;
        setShown(n);
        if (n !== value) onChange(n);
      }}
      // Leaving the field tidies it: an unreadable number goes back to the last good one.
      onBlur={() => setText(show(value))}
      className={`control tabular-nums ${invalid ? "border-danger! text-danger" : ""} ${className}`}
    />
  );
}
