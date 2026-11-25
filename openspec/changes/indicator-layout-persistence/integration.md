# Интеграция сохранения панели и списка

Полный `pnpm check`: **203/203 теста PASS**, TypeScript/ESLint/Prettier/build PASS.
`pnpm spec:validate`: **9/9 PASS**. Локальная сборка 0.3.8 / `0f63bf2e5146cf98`, 43 assets.

База worktree: `185f8e1`, ветка `fix/kline-indicator-persistence`. Canonical, сервер и браузер не
затронуты. Locale commit не переносился. Основной агент объединяет новые строки интерфейса с
локализацией после этого исправления.

## Контракт

```ts
interface IndicatorPaneLayout {
  volume?: { heightRatio: number };
}
interface ProfilePreferences {
  indicatorPaneLayout?: IndicatorPaneLayout;
}
interface ChartSettings {
  legendCollapsed?: boolean;
}
```

Доля volume ограничена 0.05–0.8, сохранена per-owner через существующие preferences/IndexedDB и
backup layout. Поля optional: старый профиль использует 95 px и раскрытый список. Разметка, UID,
данные котировок и transient toolbar popover не меняются.

## Native lifecycle

- Инициализация MA/EMA/VOL/MTP/DRAWINGS вынесена в `kline-indicators.ts` и вызывается один раз при
  создании адаптера. Полное setData вызывает applyNewData без remove/create индикаторов.
- [Публичный API KLine v9](https://v9.klinecharts.com/en-US/guide/instance-api): OnPaneDrag, getSize
  MAIN, setPaneOptions. Установленный 9.8.12 создаёт SeparatorPane с пустым id и отправляет событие
  до обновления MAIN bounding, поэтому нужен пустой paneId и отложенное microtask измерение.
- Доля вычисляется по сумме MAIN высот candle_pane и volume_pane. Resize применяет текущую локальную
  долю. Программное восстановление не сохраняется обратно. На destroy подписка снимается, ожидающий
  microtask проверяет disposed.
- Изменение layout не входит в renderKey. Seed берётся из актуального snapshot при рождении
  адаптера. Устаревший React seed не применяется обратно после native drag, что исключает скачки.

## Защита записи

В `setPreferences` добавлен необязательный третий `valid` callback, проверяемый после await
saveView/editing.flush. Обычные вызовы сохраняют прежний контракт. Основной controller содержит 493
непустые строки; locale-ветка может потребовать согласованного с основным агентом сокращения
дублирующего кода, а не отключения лимита.

Pane callback проверяет source/owner/revision/UID, текущий adapter, retired/persistView, readiness,
importingBackup/importRecoveryRequired/backupBusy; guard повторяется внутри setPreferences. Счётчик
callback оставляет только последнюю ожидающую запись. Legend callback дополнительно проверяет, что
объект chartSettings не заменён другим действием или импортом.

## Список названий

`IndicatorLegend.tsx` сохраняет существующие кнопки/контекстное меню. Отдельный chevron под списком
меняет только legendCollapsed; компактное представление показывает число названий. Сами flags,
indicatorOptions, showLegend и native render config сохраняются.

Компонент находится в normal flow внутри chart-heading сразу после chart-price. Новые стили
`indicator-legend.css` подключаются после основных стилей и отменяют абсолютное положение
top87/top74. Это устраняет зависимость списка от предположения, что OHLC всегда в одну строку.
Легенда имеет pointer-events:auto и находится вне ChartGestures.

## Проверки и пределы

Детерминированные тесты покрывают production KLine adapter с несколькими setData, реальные event
semantics MAIN-after-adjust, ratio resize, hide/show, профили/backup roundtrip, отклонение malformed
backup до записей, callbacks после await/импорта/retired, отсутствие remount и семантику collapse.
Проверка порядка элементов в heading — структурная, а не визуальная.

Для итогового визуального gate нужны обе темы/движка, drag разделителя, reload, смена инструмента,
hide/show объёма, compact legend и экран 375×667 с OHLC в две строки. Скриншоты и браузер этим
worktree не запускались по явному ограничению задачи.
