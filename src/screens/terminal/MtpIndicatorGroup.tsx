import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n/messages.js";
import type { IndicatorFlags, IndicatorKey } from "../../model/types.js";
import { mtpSelection } from "../../model/indicator-flags.js";

const parts = [
  ["mtp160", "0–160"],
  ["mtp440", "160–440"],
  ["mtp640", "440–640"]
] as const;
export function MtpIndicatorGroup({
  flags,
  onToggle,
  collapsed,
  onCollapse,
  disabled = false
}: {
  flags: IndicatorFlags;
  onToggle: (key: IndicatorKey) => void;
  collapsed: boolean;
  onCollapse: () => Promise<void>;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { all, partial } = mtpSelection(flags);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <section className="mtp-indicator-group" aria-label="MTP">
      <div className="mtp-group-heading">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls="mtp-menu-ranges"
          aria-label={t(collapsed ? "Развернуть диапазоны МТП" : "Свернуть диапазоны МТП")}
          disabled={disabled || saving}
          onClick={() => {
            setSaving(true);
            setError("");
            void (async () => {
              try {
                await onCollapse();
              } catch {
                setError(t("Не удалось сохранить настройки."));
              } finally {
                setSaving(false);
              }
            })();
          }}
        >
          <svg viewBox="0 0 14 14" aria-hidden="true" data-collapsed={collapsed}>
            <path d="m3 5 4 4 4-4" />
          </svg>
          MTP
        </button>
        <label>
          <input
            ref={ref}
            type="checkbox"
            id="indicator-mtpAll"
            checked={all}
            disabled={disabled}
            aria-checked={partial ? "mixed" : all}
            onChange={() => onToggle("mtpAll")}
          />
          0–640
        </label>
      </div>
      <div id="mtp-menu-ranges" className="mtp-menu-ranges" hidden={collapsed}>
        {parts.map(([key, name]) => (
          <label key={key}>
            <input
              type="checkbox"
              id={`indicator-${key}`}
              checked={!!flags.mtpAll || flags[key]}
              disabled={disabled}
              onChange={() => onToggle(key)}
            />
            {name}
          </label>
        ))}
      </div>
      {error && <small role="alert">{error}</small>}
    </section>
  );
}
