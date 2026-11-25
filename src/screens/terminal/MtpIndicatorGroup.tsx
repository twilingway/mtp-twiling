import { useEffect, useRef } from "react";
import type { IndicatorFlags, IndicatorKey } from "../../model/types.js";
import { mtpSelection } from "../../model/indicator-flags.js";

const parts = [
  ["mtp160", "0–160"],
  ["mtp440", "160–440"],
  ["mtp640", "440–640"]
] as const;
export function MtpIndicatorGroup({
  flags,
  onToggle
}: {
  flags: IndicatorFlags;
  onToggle: (key: IndicatorKey) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { all, partial } = mtpSelection(flags);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <fieldset className="mtp-indicator-group" style={{ margin: "10px 0", padding: "6px 10px" }}>
      <legend>MTP</legend>
      <label>
        <input
          ref={ref}
          type="checkbox"
          id="indicator-mtpAll"
          checked={all}
          aria-checked={partial ? "mixed" : all}
          onChange={() => onToggle("mtpAll")}
        />
        0–640
      </label>
      <div style={{ paddingInlineStart: 16 }}>
        {parts.map(([key, name]) => (
          <label key={key}>
            <input
              type="checkbox"
              id={`indicator-${key}`}
              checked={!!flags.mtpAll || flags[key]}
              onChange={() => onToggle(key)}
            />
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
