import { t } from "../../../i18n/messages.js";
import type { DrawingVisibility, VisibilityRule } from "../../../model/types.js";
import { draftNumber, VISIBILITY_GROUPS } from "./drawing-settings-model.js";
export function DrawingVisibilityFields({
  value,
  visibility
}: {
  value: Required<DrawingVisibility>;
  visibility: (group: keyof DrawingVisibility, patch: Partial<VisibilityRule>) => void;
}) {
  return (
    <>
      <p>{t("Показывать на интервалах")}</p>
      {VISIBILITY_GROUPS.map(([group, label, max]) => (
        <div className="visibility-row" key={group}>
          <label className="checkbox-label">
            <input
              type="checkbox"
              data-visible-group={group}
              checked={value[group].enabled}
              onChange={(event) => visibility(group, { enabled: event.currentTarget.checked })}
            />
            {t(label)}
          </label>
          <input
            type="number"
            min="1"
            max={max}
            data-visible-from={group}
            aria-label={t(label) + t(" от")}
            value={Number.isFinite(value[group].from) ? value[group].from : ""}
            onChange={(event) =>
              visibility(group, { from: draftNumber(event.currentTarget.value) })
            }
          />
          <span>—</span>
          <input
            type="number"
            min="1"
            max={max}
            data-visible-to={group}
            aria-label={t(label) + t(" до")}
            value={Number.isFinite(value[group].to) ? value[group].to : ""}
            onChange={(event) => visibility(group, { to: draftNumber(event.currentTarget.value) })}
          />
        </div>
      ))}
      <small>{t("Применяется к таймфреймам: 1, 5, 15, 30 минут, 1 час, 1 день и 1 неделя.")}</small>
    </>
  );
}
