import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { formatClock } from "../../i18n/format.js";
import { t } from "../../i18n/messages.js";
import type { Locale, TimeZoneChoice } from "../../i18n/preferences.js";
import {
  resolveTimeZone,
  searchTimeZones,
  timeZoneLabel,
  timeZoneOffset
} from "../../i18n/timezones.js";
import { useTerminal } from "./context.js";

interface TimeZonePickerProps {
  value: TimeZoneChoice;
  locale: Locale;
  now: number;
  onChange: (value: TimeZoneChoice) => void;
  clock?: boolean;
}
export function TimeZonePicker({
  value,
  locale,
  now,
  onChange,
  clock = false
}: TimeZonePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const minute = Math.floor(now / 60000);
  const zones = useMemo(
    () => (open ? searchTimeZones(query, locale, minute * 60000) : []),
    [open, query, locale, minute]
  );
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open)
      list.current
        ?.querySelector(`[data-zone-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const select = (zone: TimeZoneChoice) => {
    onChange(zone);
    setOpen(false);
    trigger.current?.focus();
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    if (!open) return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActive((previous) =>
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? Math.max(0, zones.length - 1)
            : Math.max(
                0,
                Math.min(zones.length - 1, previous + (event.key === "ArrowDown" ? 1 : -1))
              )
      );
    }
    if (event.key === "Enter" && event.target === input.current) {
      event.preventDefault();
      const zone = zones[active];
      if (zone) select(zone.zone);
    }
  };
  return (
    <div
      ref={root}
      className="clock-zone-control"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        keyboard(event);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="clock-zone-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        title={t("Часовой пояс", locale)}
        onClick={() => {
          setOpen(!open);
          setQuery("");
          setActive(0);
        }}
      >
        {clock && (
          <time dateTime={new Date(now).toISOString()}>
            {formatClock(now, { locale, timeZone: value })}
          </time>
        )}
        <span>{timeZoneLabel(value, locale)}</span>
        <span>{timeZoneOffset(value, now)}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="clock-zone-popover">
          <label htmlFor={`${id}-search`}>{t("Часовой пояс", locale)}</label>
          <input
            ref={input}
            id={`${id}-search`}
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-activedescendant={zones[active] ? `${id}-${active}` : undefined}
            placeholder={t("Поиск города или зоны", locale)}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          <div
            ref={list}
            id={`${id}-list`}
            role="listbox"
            aria-label={t("Часовой пояс", locale)}
            className="clock-zone-list"
          >
            {zones.map(({ zone, label, offset }, index) => (
              <div
                role="option"
                id={`${id}-${index}`}
                key={zone}
                aria-selected={value === zone}
                data-zone-index={index}
                data-active={active === index}
                className="clock-zone-option"
                onMouseEnter={() => setActive(index)}
                onClick={() => select(zone)}
              >
                <span>
                  <strong>{label}</strong>
                  <small>
                    {zone === "local" || zone === "exchange" ? resolveTimeZone(zone) : zone}
                  </small>
                </span>
                <span>
                  {offset}
                  {value === zone ? " ✓" : ""}
                </span>
              </div>
            ))}
            {!zones.length && <p role="status">{t("Ничего не найдено", locale)}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
/** Place beside ChartRangeControl in the chart footer; the clock uses bank-adjusted time. */
export function ClockZoneControl() {
  const { state, controller } = useTerminal();
  const [now, setNow] = useState(() => controller.marketNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(controller.marketNow()), 1000);
    return () => clearInterval(timer);
  }, [controller]);
  return (
    <TimeZonePicker
      clock
      value={state.preferences.timeZone ?? "Europe/Moscow"}
      locale={state.preferences.locale ?? "ru"}
      now={now}
      onChange={(timeZone) => {
        void controller
          .setPreferences({ timeZone })
          .catch((error: unknown) =>
            controller.notify(
              error instanceof Error ? error.message : t("Не удалось выполнить действие.")
            )
          );
      }}
    />
  );
}
