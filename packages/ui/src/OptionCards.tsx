"use client";

export interface OptionCardItem<T extends string = string> {
  id: T;
  label: string;
  description: string;
}

interface Props<T extends string> {
  options: OptionCardItem<T>[];
  selected: T | null;
  onChange: (id: T) => void;
  className?: string;
}

export function OptionCards<T extends string>({
  options,
  selected,
  onChange,
  className,
}: Props<T>) {
  return (
    <div className={["option-cards", className].filter(Boolean).join(" ")}>
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={[
            "option-card",
            selected === opt.id ? "option-card--selected" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onChange(opt.id)}
          aria-pressed={selected === opt.id}
        >
          <span className="option-card-radio">
            {selected === opt.id && <span className="option-card-radio-dot" />}
          </span>
          <span className="option-card-text">
            <span className="option-card-label">{opt.label}</span>
            <span className="option-card-desc">{opt.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
