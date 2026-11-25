# Библиотека индикаторов: интеграция

Компонент: `src/screens/terminal/IndicatorLibraryDialog.tsx`. Нужен stylesheet
`/indicator-library.css` после базовых `style.css` и `theme.css`. Подключение Toolbar/HTML
принадлежит интегратору и в этой ветке не выполнено.

Props:

```ts
interface Entry<Id extends string = string> {
  id: Id;
  label: string;
  aliases?: readonly string[];
  description?: string;
  category: "scripts" | "technicals";
  available: boolean;
  reason?: string;
}
// onClose(), onAdd(id), entries, activeIds (readonly array или ReadonlySet), locale (ru/en)
```

Caller локализует содержимое entries. Общие labels окна локализованы самим компонентом. `onAdd`
означает добавить/включить, а не toggle. Активная запись остаётся доступной для выбора; badge
показывает текущее состояние. Обработчик должен сохранить true для legacy flags либо добавить
экземпляр через движок после его интеграции. Компонент не меняет параметры, профиль или данные.

В «Моих скриптах»: `mtpAll` (MTP 0–640), `mtp160` (0–160), `mtp440` (160–440), `mtp640` (440–640). В
«Теханализе»: `rsi`, `macd`, `bollinger-bands`, `atr`, `stochastic`, `sma`, `ema`, а также legacy
`volume`. Связь `sma` с существующим legacy `ma` выполняет caller. Эти строки не расширяют
IndicatorKey банковского или профильного слоя. Компонент не содержит собственного каталога:
интегратор передаёт только поддержанные ID. Для ещё не подключённого расчёта caller передаёт
`available:false` и понятный `reason`; fallback-причина локализована. Не создавать фиктивные
series/points ради активной кнопки.

Поиск фильтрует label/aliases текущего раздела без сети, case-insensitive substring, Unicode NFKC.
Описание и причина не участвуют в поиске. Запрос сохраняется при смене раздела. Первоначальный
раздел — «Мои скрипты». Клик не закрывает окно, позволяя добавить несколько индикаторов.

Начальный фокус — поиск; ArrowDown переводит к первому доступному результату. В списке ArrowUp/Down,
Home/End перемещают фокус по доступным кнопкам; Enter/Space работают нативно. Escape закрывает окно.
Модальность, Tab и возврат фокуса использует existing native Modal; browser-проверка остаётся
интегратору. Для этого экземпляра локальный effect добавляет accessible name и close label по
locale.

Размер: 840px, адаптивная высота; до 600px окно полноэкранное. Используются текущие theme variables,
selected sidebar highlight, hover и focus-visible. Нет платных, общественных или иных скрытых
категорий, нет fake buttons и несуществующих вкладок.

Первичный ориентир:
[TradingView, создание скрипта](https://www.tradingview.com/support/solutions/43000711497-how-to-create-a-new-script/)
называет категории «My scripts» и «Technicals» и добавление нажатием на имя;
[Built-in source](https://www.tradingview.com/support/solutions/43000481659-i-want-to-see-the-source-code-of-a-built-in-script/)
описывает Technicals в левой панели. Использовано поведение из документации, проприетарные
компоненты не копировались. Размеры и ограничение двумя разделами — прямое требование пользователя.

Проверки: `node --test test/indicator-library.test.mjs`, `pnpm check`, `pnpm build`,
`pnpm spec:validate`. SSR и unit-тесты не доказывают визуальный результат. Браузер и runtime не
запускались: QA-профиль занят проверкой release 0.3.12. После подключения интегратор проверяет
desktop/mobile 375px, фокус и закрытие.

Результат проверки этой ветки: pnpm check — 369/369 тестов (включая 5 новых),
format/lint/typecheck/build успешно; pnpm spec:validate — 21/21. Первая sandbox-попытка node test
завершилась spawn EPERM; полный check успешно повторён вне sandbox без изменения кода ради ошибки
окружения.
