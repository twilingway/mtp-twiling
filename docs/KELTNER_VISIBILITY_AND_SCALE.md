# Видимость линий, прозрачность и шкала KC

Выключение ряда и прозрачный цвет — разные настройки. Checkbox в Style управляет
`OutputStyle.visible`: выключенный public plot не участвует в autoscale. Непрозрачность 0 сохраняет
включённый plot и его настоящие значения, но скрывает чернила линии.

Принятый контракт остаётся прежним: plot scale — `include-when-visible`, fill scale — `none`.
Декоративная заливка использует существующую проекцию, самостоятельную шкалу не создаёт. Hidden
internal series и искусственные числовые anchors для этого не добавляются.

## Сценарии

| Состояние                                                                    | Шкала                                 | Заливка                                     |
| ---------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------- |
| Три plots включены, обычные цвета                                            | По настоящим upper/basis/lower        | Рисуется                                    |
| Три plots включены, opacity=0                                                | По тем же настоящим upper/basis/lower | Может оставаться видимой без линий          |
| Lower выключен                                                               | Его значения исключены                | Может обрезаться новой шкалой               |
| Все plots выключены, но есть candles/другой видимый источник в той же панели | По этому законному источнику          | Использует его проекцию                     |
| Все plots выключены, собственная панель без других источников                | Текущего диапазона данных нет         | Пригодная ценовая проекция не гарантируется |

Native empty-domain поведение SDK различается: LW может временно сохранить прежний диапазон, а после
fresh reload использует служебный −0.5…0.5; KLine использует служебный 0…10. Это не котировки и не
скрытые цены, добавленные приложением. Внешне удачный LW post-toggle сам по себе не доказывает
корректного нового autoscale.

Для сценария «только заливка» используются включённые plots с полностью прозрачными цветами. 20
controlled installed-native probes на одних данных подтвердили одинаковый настоящий source range
обоих SDK, три stroke alpha=0 и отдельную fill opacity=0.05. Это source/native evidence; fresh
PRODUCT proof после reload/engine switch/mobile остаётся отдельной проверкой.

## Приёмка и отдельный дефект

Первый product report кандидата `88d3509171fa4e690abec2267bdb8793d43813dd` сохранён без изменений:
21 просмотренный PNG, all-plots-disabled own pane после reload пустая. Его требование создать новую
шкалу для декоративного fill не соответствует принятому контракту. Это основание уточнить сценарий,
а не переименовать исходный отчёт в PASS.

Независимые mixed-precision пробы затем выявили отдельный реальный дефект KLine: inactive native
owner и fill companion с пустыми figures/results всё ещё меняют min/max precision активного соседа.
При precision2 они расширяют близкий range, при precision8 меняют формат подписей. Удаление обоих
восстанавливает baseline; выключить только один недостаточно. Этот дефект требует runtime
исправления и остаётся release gate. Числа kernels и portable styles от этого не меняются.

Primary docs подтверждают отсутствие scale contribution у `display.none`, отдельную видимость fill и
возможность скрывать ink прозрачным цветом:
[Plots](https://www.tradingview.com/pine-script-docs/visuals/plots/),
[Visuals overview](https://www.tradingview.com/pine-script-docs/visuals/overview/). Точное
отображение TradingView Style checkbox и fresh pane paint из этих текстов не выводится;
авторизованный TradingView execution oracle здесь не получен.

Подробные локальные evidence: `ta-fill-scale-contract-review/REPORT.md`,
`ta-kline-inactive-precision-review/REPORT.md`, `release-0324-keltner-product-qa/report.json`.
