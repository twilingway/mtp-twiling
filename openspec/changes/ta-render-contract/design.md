# Design

## Context

См. proposal и [исследование](../../../docs/TA_RENDER_CONTRACT_RESEARCH.md): первичные sources с
version/SHA, installed API с точными путями/строками и ограничения sparse math. 42 numeric results
frozen. Supertrend/SAR пока math-only на reviewed `49bfcf77c9a5200f8bcaf6d70735bd167c500b5f`.

## Goals / Non-Goals

**Goals:** проверяемый проект общих geometry/style/fill descriptors, одинаковая семантика двух
engines, сохранение numeric42 и v1 настроек, собственные ресурсы и понятная миграционная граница.

**Non-Goals:** реализация, регистрация, перенос Pine source, новые зависимости, изменение формул,
автоматическая миграция профилей, изменение MTP, build/browser/release в research этапе.

## Decisions

### 1. Разделить numeric результат и render metadata

Typed sketch в исследовании §4 — предлагаемый контракт. Общий compiler проверяет ссылки
seriesKey/fill anchors, длины/nulls и создаёт render graph. Definition без нового descriptor
сохраняет legacy поведение; MACD/PVO/AO получают намеренный descriptor columns/palette. Не вводить
hardcoded ID branches в каждом adapter. Numeric result, timestamps и history не меняются. Отклонён
вариант добавлять colors/callbacks в numeric result: он смешивает математические и runtime данные.

### 2. Применить public native API без per-segment series

LW: числовой LineSeries carrier с невидимой линией и выключенными markers/labels; primitive рисует
cross или linebr по исходным индексам. Так сохраняется native autoscale без ложной гарантии, что
whitespace разрывает встроенную линию. Native circles не заменяют SAR cross. Альтернатива custom
series допустима только при доказанном ограничении carrier/primitive.

KLine: SAR custom draw с одним value figure для scale, без соединений; ST visible figures только
up/down. bodyMiddle/direction хранятся в runtime context, не в figures. Linebr использует native
adjacent-current-next правило после browser gate, иначе общий indexed segment renderer.

### 3. Задать fill и слои явно

LW normal primitive.drawBackground выполняется после grid, перед foreground всех series. Body anchor
проецируется через trend price scale без отдельной series. bottom/top не подходят.

KLine fill companion figures=[] с negative zLevel=-3 рисует destination-over; native grid позже
рисует destination-over ещё ниже. Existing DRAWINGS(-2), MTP(-1) сохраняют своё относительное
поведение; фактическое сочетание с fill требует browser review. Линии остаются выше цены/под
курсором.

Fill строится только между соседними полностью известными anchor pairs одного направления. Нет моста
через null/reversal, нет extrapolation на полбара; singleton/cap semantics — G2 gate. Первый бар и
sparse masks сохраняются из math. Скрытые anchors не расширяют scale.

### 4. Оформление и persistent версия

Предлагаемая policy: отсутствующий v1 style включает descriptor default; любой явный v1 color
сохраняет solid. Старый form сохранял defaultcolor при редактировании period, поэтому эвристика по
равенству цвета не восстанавливает намерение пользователя.

Предпочтительный будущий instance v2 использует tagged default/solid modes и отдельные fillStyles.
Весь путь exact validators → JSON/storage → Drive whitelist → UI обновляет один integrator атомарно.
До одобрения export/old-reader/rollback решения v2 не внедряется. Альтернатива v1 delete-style reset
явно теряет остальные per-output изменения и требует отдельного выбора.

### 5. Владельцы и зависимости

Полная таблица путей в исследовании §5. Graph: `G → C → {P,L,K}; {C,L,K,math} → R; {P,L,K,R} → Q`.

- C единолично владеет shared numeric/render types/compiler и integration edits.
- P владеет persistent validators/backup/Drive/UI; общие файлы изменяет последовательно с C.
- L и K владеют только собственными adapters/новыми geometry modules и тестами.
- R не регистрирует SAR/ST до готовых L/K; TSI/KST/Fisher остаются отдельной работой.
- Q проверяет реальный paint и существующий MTP; mock callbacks не заменяют browser evidence.

## Risks / Trade-offs

- [Pine cross linewidth относительный] → калибровать общий CSS profile на reference, не считать его
  1px.
- [linebr singleton/clip] → tiny fixture + actual browser; индексный renderer исключает мосты.
- [Fill alpha/order отличается от ожидаемого] → grid/fill/candle/MTP witness на обоих engines.
- [Old color intent потерян исторически] → сохранить все explicit v1 colors solid; дать явный reset.
- [Sparse palette не исполнялась в Pine] → тестируемая локальная branch policy, отдельный parity
  gate.
- [KLine hidden figure остаётся в scale] → hidden outputs не создают figures вообще.
- [Coordinate/heap cost] → visible-range painting, invalidation по data/style/camera/DPR, bounded
  resources.
- [Runtime objects попадают в backup] → strict scalar-only serializers и negative roundtrip
  fixtures.

## Migration Plan

Только план. Сначала сохранить v1 fixture corpus и numeric42 baseline. После одобрения G5 внедрить
v2 union/validators/serialization вместе с UI, продолжить чтение v1. Не переписывать data при
чтении; преобразование перед записью только после успешной полной validation. Backup envelope
version и old-reader policy должны быть зафиксированы отдельным решением. До этого v2 export
запрещён.

Rollback render-only части удаляет owned resources/descriptor feature, оставляет numeric/profile
data. Rollback после v2 записи требует согласованного reader либо явного обратного export; молча
терять fill/default flags нельзя. Никакой Drive mutation в исследовании или для проверки fixture.

## Open Questions

Это **gated proposal**, а не разрешение apply. G1–G6 из исследования требуют review до реализации
соответствующей ветви: cross pixels, singleton/caps, фактический fill/MTP порядок, missing palette,
v2 export compatibility и согласие на render metadata extension. Пока gate не закрыт
evidence/решением, соответствующий task остаётся unchecked. Отдельное approval решение фиксирует
integrator; никакие default assumptions не выдаются за принятую persistent migration.
