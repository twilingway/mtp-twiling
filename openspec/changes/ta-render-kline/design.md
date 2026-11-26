# Design

## Context

Основа: shared bridge `a2117a8` с policy follow-up `bda56f7` (локально `c7f55ad`). Решения
согласованы в `docs/TA_RENDER_IMPLEMENTATION_DECISIONS.md`; точные native evidence и limits —
`docs/TA_RENDER_KLINE.md`.

## Goals / Non-Goals

**Goals:** потребить frozen presentation contract в KLine, сохранить оси, камеру и прежние 45
numeric paths.

**Non-Goals:** включение новых definitions, UI, сохранение новых настроек, LW, сборка и браузерная
проверка.

## Decisions

1. Cross и linebr рисует owner draw callback. Figures содержат только видимые настоящие outputs для
   scale/tooltip. Draw clipping сохраняет исходные индексы; singleton не создаёт segment/fill.
   Columns-only остаётся на native figures со shared color callback.
2. Заливки рисует один owned companion на instance, `figures=[]`, `calc=[]`; anchors доступны только
   через context. Отрицательный z `-3-order` и обратный порядок fills согласованы с native
   destination-over. MTP -1 и drawings -2 остаются выше fills.
3. Policy выбирает зарегистрированный класс до native create/sync. `native-price` имеет
   class-default Price без explicit precision, включая нижнюю pane. `legacy-fixed-6` сохраняет
   Normal class и explicit6 descriptor. Никаких min/max/shouldOhlc overrides.
4. Ноль columns — typed native-only semantic, не quote и не output. Public custom no-op figure стоит
   первым; nonenumerable collision-guarded row key равен0 только на finite visible column slot.
   Native range читает key; pinned eachFigures пропускает custom type без default style до первого
   line/bar. Это предотвращает paint/tooltip/axis-label pollution. Альтернативы min/max0 и pane
   recreation отклонены: hidden/all-null pollution и нарушение geometry ownership.
5. Четыре семейства по100 reusable names и один custom figure. Глобальные callbacks не содержат
   chart/data closures; context очищается при удалении. Native settlement использует WeakRef и
   revision guard.

## Risks / Trade-offs

- Custom figure skip зависит от installed9.8.12 SPI → SHA pin и actual SDK
  paint/axis/tooltip/crosshair/range tests.
- Native destination-over trace не доказывает итоговые пиксели → G2 browser gate у интегратора.
- Pine relative cross size реализован профилем CSS pixel, точная калибровка остаётся G2.
- Не положительные значения на log scale и inverted axis зависят от native projection → invalid
  projection разрывает geometry; browser matrix обязателен.
- Reconcile строит rows по всей истории, draw ограничен viewport+один сосед; polygon allocation
  пропорционален видимому run. Большие viewport требуют performance QA.

## Migration Plan

Перенести source-only commit после review, подключить metadata отдельной общей задачей, затем
browser G2. Миграции persistence нет; rollback только renderer commit. Shared policy follow-up
обязателен до consumer.
