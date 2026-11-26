# Spec Delta

## Purpose

Определить согласованное отображение числовых TA на двух графических движках с явными разрывами,
заливками и оформлением, сохраняя пользовательские настройки и математические результаты. Это проект
будущего поведения; research commit не включает его реализацию.

## ADDED Requirements

### Requirement: Несоединённый SAR

Система SHALL отображать SAR в price overlay отдельными синими cross glyphs по конечным значениям.
По умолчанию цвет #2962FF и относительный размер Pine1. Система MUST исключать соединяющую линию и
неизвестные значения; конечные видимые SAR значения участвуют в autoscale.

#### Scenario: SAR с пропуском

- **WHEN** числовые значения SAR равны `[100,null,105]`
- **THEN** отображаются два отдельных cross, без линии между ними и без glyph на пропуске
- **AND** autoscale учитывает 100 и 105, исключает null

#### Scenario: Скрытый SAR

- **WHEN** пользователь скрывает SAR
- **THEN** glyphs исчезают и SAR не расширяет price autoscale

### Requirement: Линии и скрытые данные Supertrend

Система SHALL показывать up/down Supertrend отдельными linebr plots по направлению. Система MUST
сохранять firstbar/warmup/null masks. direction/value/bodyMiddle не создают дополнительных видимых
линий или axis values; hidden bodyMiddle и direction не влияют на autoscale.

#### Scenario: Разворот и скрытые anchors

- **WHEN** upTrend задан на первых двух барах, затем null, а downTrend известен на следующих двух
- **THEN** между up/down сегментами отсутствует соединение
- **AND** значения direction ±1 и hidden bodyMiddle не расширяют price scale и не показывают labels

#### Scenario: Прогрев и первый бар

- **WHEN** reviewed numeric результат скрывает первый бар и ATR warmup
- **THEN** renderer сохраняет эти null, не восстанавливает цены и не создаёт искусственных точек

### Requirement: Направленные Supertrend fills

Система SHALL заливать область bodyMiddle→активный trend цветом направления с default opacity0.1.
Система MUST прекращать fill на null/reversal, не соединять несоседние anchors и не показывать
hidden anchor как самостоятельный plot.

#### Scenario: Missing open при известном trend

- **WHEN** trend известен, но bodyMiddle текущего бара null из-за missing open
- **THEN** trend остаётся видимым, а fill не пересекает этот бар

#### Scenario: Два направления

- **WHEN** direction меняется между соседними барами
- **THEN** старый fill заканчивается на последнем валидном центре старой ветви
- **AND** новый fill начинается на первом валидном центре новой ветви без диагонального моста

### Requirement: Порядок слоёв и существующий MTP

Система SHALL рисовать grid ниже TA fills, fills ниже price, а cursor выше price/TA. Система MUST
сохранять существующий MTP и drawing behavior, оси и обработку pointer, не внося изменений в их
числовые bounds и пользовательскую camera при добавлении TA.

#### Scenario: Grid, fill, цена и MTP

- **WHEN** включены grid, Supertrend fill, MTP и рисунок
- **THEN** fill визуально находится выше grid и ниже цены, курсор виден выше TA
- **AND** MTP bounds/lines, рисунок и выбранная camera сохраняют прежнее поведение

### Requirement: Default histogram palettes

Система SHALL применять четырёхцветную sign/change palette MACD/PVO и двухцветную change palette AO
при default оформлении; ноль относится к nonnegative MACD/PVO. Система MUST пропускать current null
и использовать явно принятую missing-previous policy, одинаковую на обоих engines.

#### Scenario: AO не зависит от знака

- **WHEN** AO растёт от -5 до -3 либо от 3 до 5
- **THEN** текущий столбец имеет растущий цвет #009688
- **AND** при равенстве либо падении он имеет #F44336

#### Scenario: MACD и PVO по обе стороны нуля

- **WHEN** histogram растёт/не растёт на h>=0 либо h<0
- **THEN** цвета соответственно #26A69A/#B2DFDB либо #FFCDD2/#FF5252
- **AND** текущий null не рисует столбца

### Requirement: Default и явное оформление

Система SHALL сохранять любой явно сохранённый v1 color как solid и применять новую palette только
при отсутствующем style или явном reset. Система MUST давать понятный выбор default/solid; равенство
сохранённого цвета старому default не разрешает автоматическую миграцию намерения.

#### Scenario: Старое изменение периода

- **WHEN** v1 instance содержит прежний default color после изменения period
- **THEN** сохранённый цвет остаётся solid до явного reset пользователя

#### Scenario: Ручной цвет и возврат к default

- **WHEN** пользователь выбирает ручной цвет, затем явно возвращает default palette
- **THEN** ручной режим отключает palette, а явный reset включает её
- **AND** остальные независимые настройки сохраняются в принятой версии оформления

### Requirement: Числовая и persistent совместимость

Система MUST сохранять числовые результаты, params, timestamps/nulls/history и v1 сохранения
прежних42. Новая render metadata версионируется отдельно. Новая persistent версия принимается только
после согласованного migration/export решения и проверяется до записи; runtime объекты не входят в
backup.

#### Scenario: Render metadata расширена

- **WHEN** существующий TA получает новый presentation descriptor
- **THEN** его numeric result и сохранённые v1 params/styles остаются прежними
- **AND** намеренное изменение картинки проверяется отдельно

#### Scenario: Некорректный импорт

- **WHEN** backup содержит runtime callback, неизвестную версию/ключ либо нечисловой style parameter
- **THEN** импорт отклоняется до записи и текущие пользовательские данные сохраняются

### Requirement: Владение и проверка реального paint

Система MUST удалять только принадлежащие экземпляру native ресурсы и исключать устаревшие callbacks
после dispose. Приёмка нового отображения SHALL включать actual browser evidence обоих engines;
DOM/mock тест не заменяет визуальную проверку.

#### Scenario: Удаление во время native calc

- **WHEN** экземпляр удалён до завершения отложенного native расчёта
- **THEN** callback не воссоздаёт plot/fill/pane и не обращается к disposed chart

#### Scenario: Приёмка реализации

- **WHEN** implementation объявляется готовой к review
- **THEN** доступны exact candidate SHA, версии engines и browser evidence
  crosses/gaps/fills/scale/MTP
- **AND** numeric/persistence tests и scoped performance results приложены отдельно
