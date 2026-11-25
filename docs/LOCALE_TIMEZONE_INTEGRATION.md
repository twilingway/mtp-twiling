# Язык и часовой пояс: интеграция

Интеграция координатором выполнена в отдельной ветке: общий footer с ClockZoneControl,
calendarAxisDisplay в обоих движках и реальные LW timeAxisPaneViews для подписей тех же локальных
календарных границ, что использует сетка. Новые элементы интервалов переведены. Добавлены 3
regression tests: Moscow midnight, NY DST 23h и совпадение grid/label coordinates; все 16
locale/calendar tests PASS. Общая браузерная проверка объединённого выпуска ещё впереди. Раздел ниже
описывает исходный контракт интеграции и остаётся справочным.

Компонент `src/screens/terminal/ClockZoneControl.tsx` экспортирует `ClockZoneControl()` для правой
части нижней панели рядом с `ChartRangeControl`. Он использует активный owner profile,
`controller.marketNow()` и собственный секундный таймер. CSS подключён в `public/index.html`.

Настройки сохраняют `preferences.locale: ru|en`, `preferences.timeZone: IANA|UTC|local|exchange`.
Старые профили получают ru/Europe/Moscow. `local` определяется через Intl, `exchange` сейчас
Europe/Moscow для MOEX. Backup validator проверяет оба поля. UTC данные, history keys, view keys и
calendar APIs не меняются.

## Совмещение с 13 native intervals

Новая функция `calendarAxisDisplay(timeframe, preferences)` из `src/i18n/calendar-axis.ts`
предоставляет готовый интерфейс:

```ts
interface CalendarAxisDisplay {
  parts(utcTimestamp: number): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  };
  year(utcTimestamp: number): string;
  month(utcTimestamp: number): string;
  day(utcTimestamp: number): string;
  clock(utcTimestamp: number): string;
}
```

Для `1d/1w/1M` все callbacks используют UTC trading date; для `1m..4h` — выбранную IANA. Пример:
`2026-03-04T22:00Z` имеет day=5 в Moscow на 1h, но day=4 на 1d. DST учитывает конкретный timestamp.

В `intervals/axis-ticks.ts` передать optional `display: CalendarAxisDisplay` в `calendarAxisTicks`
options и дополнительным аргументом в `lightweightCalendarLabel`. В boundary detection сравнивать
`display.parts(timestamp)` и `display.parts(previous.timestamp)` вместо `getUTC*`, в текстах
применять `display.year/month/day/clock`. Позиции и значения свечей сохраняются. Обе фабрики
получают `calendarAxisDisplay(timeframe, options)`. Эти callbacks уже покрыты unit test.

Конфликтующие места при merge: `charts/lightweight.ts` timeScale.tickMarkFormatter/localization и
`charts/kline.ts` init customApi. Сохранить native calendar tick density logic и подключить timezone
callbacks для текста и локальных границ. TickMarkType задаёт библиотека LW; один formatter меняет
текст, но не внутренние позиции/веса тиков LW. Не утверждать, что изменённые локальные границы LW
проверены, пока это не доказано браузером.

## Приёмка

Проверить RU/EN, обе библиотеки, NY DST, Moscow, UTC, Kathmandu +05:45, поиск и прокрутку всего
списка, Arrow/Home/End/Enter/Escape, клик снаружи, отсутствие жеста графика при выборе. D/W/M в New
York должны сохранить исходную торговую дату. В drawing coordinates intraday выбранная зона; D/W/M
UTC trading date. DST gap отвергается, повторный час сохраняет исходный occurrence.

Официальная семантика DWM:
https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/ —
trading date 00:00 UTC, не начало сессии. Данные T‑Invest не перезаписываются ради отображения.
