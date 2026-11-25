# Design

## Context

См. proposal.md. В текущем source `LineStyle` — строковый union `solid | dashed | dotted`.
Единственный список стилей находится в DrawingStylePopover; фиксированные символы в
DrawingSettingsDialog не отражают выбор. Окно использует native dialog.showModal().

## Goals / Non-Goals

**Goals:** переиспользуемый SVG-образец, доступный список и одинаковые стрелки в drawing UI.

**Non-Goals:** изменение типов, формата backup, математики линий, глобальных select и общего релиза.

## Decisions

- LineStylePicker принимает value/onChange/label и необязательные name/color/opacity/width/disabled.
  Использует существующий LineStyle без преобразования.
- Фокус остаётся на combobox-кнопке; aria-activedescendant указывает активный option. Стрелки меняют
  активный вариант, Enter подтверждает, Escape отменяет, Tab закрывает без перехвата перехода
  фокуса.
- Popup портируется внутрь ближайшего dialog, иначе body. Это сохраняет native top layer и исключает
  обрезание в colour-popover. Прозрачный экран закрывает список кликом снаружи и поглощает жест
  графика.
- ChevronIcon — симметричный SVG 16×16 со stroke 1.5; состояние aria-expanded поворачивает стрелку.
  Split-кнопка панели сохраняет существующие обработчики и получает отдельную flex-ячейку.

## Risks / Trade-offs

- Native modal Escape → обработчик открытого списка отменяет default в capture phase до cancel
  диалога.
- CSS нового списка не подключён standalone → координатор подключает public/drawing-controls.css при
  интеграции и проверяет визуально.
- Низкая прозрачность образца → сохраняется выбранная прозрачность без изменения стиля runtime;
  текстовое название остаётся доступным.
