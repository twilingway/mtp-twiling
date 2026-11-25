# Spec Delta

## Purpose

Позволяет редактировать существующие рисунки с немедленным отображением настроек на графике,
сохраняя незавершённые изменения отдельно от переносимых данных и истории отмены.

## ADDED Requirements

### Requirement: Complete transient preview

Все реализованные настройки segment, ray, full line, horizontal, horizontal ray, vertical, Fibonacci
retracement и extension SHALL сразу отображаться на графике. Это включает стиль, уровни, шрифт,
координаты, видимость и применённые шаблоны. Невалидное числовое поле SHALL сохранять committed
оригинал и не подтверждаться.

#### Scenario: Change existing drawing

- **WHEN** пользователь меняет настройки любого реализованного инструмента
- **THEN** график показывает валидный draft без записи committed рисунка

### Requirement: Portable data remains committed

Drive, JSON backup, IDB и undo SHALL видеть только committed рисунки до ОК, включая экспорт и
автосинхронизацию во время редактирования.

#### Scenario: Backup during draft

- **WHEN** запускается резервное копирование или синхронизация при открытом draft
- **THEN** переносится оригинальный committed рисунок, без draft

### Requirement: Scoped cancel and one action commit

Cancel, Escape, закрытие, unmount, смена owner/symbol/UID/engine/timeframe и импорт SHALL убирать
предпросмотр. Устаревший draft SHALL не сохраняться. ОК SHALL сохранять весь draft одним действием с
рабочими undo/redo. Редактирование стиля locked объекта SHALL сохранять существующее поведение и не
снимать drag lock.

#### Scenario: Cancel or scope change

- **WHEN** пользователь отменяет draft либо меняется контекст
- **THEN** график показывает committed данные, а отложенное подтверждение draft отклоняется

#### Scenario: Confirm all settings

- **WHEN** пользователь подтверждает валидные изменения
- **THEN** ОК сохраняет одно действие, Ctrl+Z восстанавливает оригинал, redo возвращает результат

### Requirement: Visible opacity controls

Style SHALL показывать цвет, толщину, тип и прозрачность основной и трендовой линий без открытия
палитры. Прозрачность линий и фона Fibonacci SHALL иметь шахматную подложку, градиент прозрачности и
видимые проценты.

#### Scenario: Adjust opacity in Style

- **WHEN** пользователь открывает Style и изменяет прозрачность
- **THEN** видит процент и графический результат без открытия палитры
