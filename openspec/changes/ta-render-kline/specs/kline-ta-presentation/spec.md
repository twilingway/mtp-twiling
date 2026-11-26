# Spec Delta

## Purpose

Определить отображение TA presentation metadata в KLine с сохранением исходных чисел, индексов,
пользовательской камеры и независимости осей от скрытых служебных данных.

## ADDED Requirements

### Requirement: Индексная геометрия

Renderer SHALL показывать cross без соединений, а break-линии и заливки SHALL разрываться на
отсутствующих или непроецируемых значениях.

#### Scenario: Разворот и первый бар

- **WHEN** последовательность содержит null между двумя finite runs и отдельный finite singleton
- **THEN** линия соединяет только соседние значения внутри каждого run, заливка требует две пары
  anchors, cross остаётся отдельным знаком на finite индексе

### Requirement: Независимость заливки и шкалы

Заливка SHALL находиться выше grid и ниже price, MTP и drawings. Служебные anchors SHALL
отсутствовать в scale, tooltip и crosshair outputs.

#### Scenario: Скрытый stroke и reorder

- **WHEN** stroke скрыт, заливка видима и порядок instances изменён
- **THEN** заливка сохраняется, следует новому порядку и не расширяет диапазон собственными anchors

### Requirement: Семантика columns

Видимые finite metadata columns SHALL включать ноль в диапазон соответствующего viewport без
дополнительного пользовательского output. Цвет SHALL определяться общим palette resolver или явным
solid style.

#### Scenario: Только отрицательные значения

- **WHEN** columns отрицательны, затем скрыты, удалены или viewport содержит только null columns
- **THEN** сначала диапазон включает0, затем точно возвращается к диапазону остальных владельцев;
  tooltip, axis labels и crosshair не содержат baseline

### Requirement: Native precision и совместимость

Native-price presentation SHALL следовать текущей price precision независимо от pane. Legacy45 SHALL
сохранять прежние numeric results, explicit6 path и persisted settings.

#### Scenario: Смена precision и нижняя pane

- **WHEN** owner с fill перемещён вниз, price precision меняется6→8→6, затем instance скрыт и удалён
- **THEN** owner и companion следуют policy, companion не меняет диапазон и после удаления остаётся
  исходный диапазон

### Requirement: Изоляция владельцев

Удаление instance или chart SHALL освобождать его context и исключать поздние paint/layout
callbacks; registry SHALL оставаться bounded при повторном использовании slots.

#### Scenario: Поздний native callback

- **WHEN** instance удалён до завершения native calc и slot занят другим владельцем
- **THEN** старый context не рисует, не публикует metrics и не содержит данных нового владельца
