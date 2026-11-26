## Purpose

Скрывать произвольные crosshair prices в компактных технических панелях, сохраняя cursor mode,
время, геометрию и данные графика.

## ADDED Requirements

### Requirement: Compact hover

Терминал SHALL скрывать horizontal crosshair label только над TA pane с фактической высотой<=30
CSSpx. Main, legacy и expanded panes SHALL сохранять исходные flags; vertical time cursor и
пользовательский mode MUST оставаться неизменными.

#### Scenario: Collapsed или вручную уменьшенная панель

- **WHEN** pointer попадает в30px TA strip независимо от collapsed preference
- **THEN** horizontal price не показывается, vertical time cursor сохраняется и шкалы/данные не
  меняются

### Requirement: Lifecycle restore

Терминал SHALL восстановить original horizontal flags при leave/main/legacy/expand/removal,
правильно разрешать stationary pointer после reorder и отключать listener при dispose. Axis widths,
ranges, camera и pane heights MUST оставаться прежними при hover.

#### Scenario: Изменение панели под stationary pointer

- **WHEN** hovered compact pane разворачивается, удаляется или перемещается
- **THEN** политика пересчитывается по текущим bounds и после dispose новые события не применяют
  options
