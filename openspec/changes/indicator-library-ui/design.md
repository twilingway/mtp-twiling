# Design

## Context

См. proposal.md. Существующий Modal уже использует native dialog/showModal и cancel; его файл
закреплён за интегратором.

## Goals / Non-Goals

**Goals:** Передать готовый диалог через props entries/activeIds/locale/onAdd/onClose. Изолировать
поиск от React и доступность записей от математической реализации.

**Non-Goals:** Toolbar, quick dropdown, контроллер, хранение, параметры, вычисления, платные и
общественные категории.

## Decisions

- Caller передаёт доступность и локализованные label/aliases/description/reason; диалог не объявляет
  ещё не реализованный расчёт доступным. ID остаётся строковым, совместимым с замороженным
  каталогом.
- Поиск нечувствителен к регистру и проверяет substring label/aliases только выбранного раздела.
  Сеть и debounce не нужны.
- Native buttons обеспечивают Enter/Space, native dialog — модальность и Escape. ArrowDown из поиска
  переводит фокус на первую доступную запись; стрелки списка/Home/End перемещают фокус между
  доступными записями.
- Уникальный dialog id и локальный effect задают accessible name и локализованный close label без
  изменения общего Modal.
- Стиль отдельным CSS, ширина 840px; при viewport до 600px окно занимает экран. Установку CSS link
  делает интегратор.

## Risks / Trade-offs

- [Caller может использовать старый toggle] → контракт onAdd означает enable/add, повторный выбор не
  выключает запись.
- [Математика части каталога ещё не объединена] → available/reason обязательны при формировании
  entries; нет демонстрационных точек.
- [Визуальная проверка ещё не выполнена] → отдельные SSR/модельные проверки и полный build;
  интегратор выполняет browser smoke после освобождения QA. Визуальное соответствие пока не
  заявляется.

## Integration

Toolbar/App подключены через TerminalIndicatorControls и TerminalIndicatorLibrary. Каталог этой
версии ограничен четырьмя MTP, Volume, SMA 20 и EMA 50; будущая pure math core ещё не является
доступностью native adapter. Строковый ID sma преобразуется в legacy ma только в wrapper.
Enable-only helper сохраняет master MTP и не создаёт дублирующие диапазоны.

Сохранение collapse и выбора проходит через существующий setPreferences с дополнительным valid
predicate: owner/session/revision/import boundaries и ссылка исходных preferences. Подписка
запоминает даже уже завершившийся переход границы. Локальный pending блокирует повторный ввод, catch
освобождает состояние и показывает ошибку только актуальному владельцу.

mtpMenuCollapsed проверяется как boolean в backup и включён в Drive allowlist, но не входит в белый
список native render config. Полноэкранная прозрачная dismiss-кнопка поглощает pointerdown и
закрывает меню только на click, исключая снятие защиты посередине жеста. Фактический browser smoke
остаётся follow-up.
