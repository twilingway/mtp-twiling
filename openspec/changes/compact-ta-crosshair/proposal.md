# Proposal

## Why

Actual product QA обнаружил arbitrary horizontal crosshair prices в30px TA strip после скрытия
статических ticks. Пользователь видит значение несуществующей компактной шкалы при наведении.

## What Changes

- Подавлять horizontal price label только при hover фактической TA pane высотой<=30 CSSpx, включая
  manual resize.
- Восстанавливать исходные flags при main/legacy/expanded/leave, expand/remove/reorder/dispose;
  vertical time cursor и пользовательский cursor mode сохраняются.
- Удерживать текущую axis width через public sizing options во время подавления, не выключая native
  axis widgets и не меняя данные/шкалы/camera.

## Capabilities

### New Capabilities

- `compact-ta-crosshair`: корректный hover для compact технических панелей.

### Modified Capabilities

Нет.

## Impact

Один owned crosshair listener на technical manager, shared helper и точечные native manager hooks.
Source/actual SDK fixture tests, docs/OpenSpec. Browser follow-up отдельно в fresh worker; app
build/version/release не входят.
