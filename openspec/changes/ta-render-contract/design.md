# Design

## Context

См. proposal и [исследование](../../../docs/TA_RENDER_CONTRACT_RESEARCH.md): первичные sources с
version/SHA, installed API с точными путями/строками и ограничения sparse math. 42 numeric results
frozen. Supertrend/SAR пока math-only на reviewed `49bfcf77c9a5200f8bcaf6d70735bd167c500b5f`.

## Goals / Non-Goals

**Goals:** проверяемый проект общих geometry/style/fill descriptors, одинаковая семантика двух
engines, сохранение numeric42 и v1 настроек, собственные ресурсы и понятная миграционная граница.

**Non-Goals:** перенос Pine source, новые зависимости, изменение формул, автоматическая миграция
профилей и изменение MTP. Research этап не включал реализацию; source-only compiler принят отдельно
в `docs/TA_RENDER_IMPLEMENTATION_DECISIONS.md`. Native регистрация, build/browser/release и
persistent migration остаются следующими этапами.

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

Обязательное дополнение после independent review: companion нейтрален не только по figures, но и по
effective precision/scale policy. New SAR/ST owner+companion регистрируются Series.Price до create
sync, без explicit precision overrides; оба следуют native price precision. Поздний override Price
не исправляет create/sync-before-override. Explicit precision ставит private flag только при
фактическом изменении числа; одинаковый descriptor6 может дать разные future sync. Читать/менять
private flag запрещено. Legacy42 explicit6 path не менять попутно; companion к legacy pinned owner
требует отдельного протокола. Companion не задаёт min/max/shouldOhlc.

Доказательство: [probe](probes/kline-precision-probe.mjs) исполняет extracted installed calcRange,
setPrecision/sync и sequence model. Default4 даёт flat range≈8e-4 против baseline6≈8e-6, matching6/8
сохраняет range даже hidden/collapsed. Это не actual create/canvas. G7 требует native
registration/create→sync→override→precision6→8→6→reconcile tests и browser range equality при
hide/collapse/remove. figures=[]/visible=false/options equality сами не доказывают neutrality.

Fill строится только между соседними полностью известными anchor pairs одного направления. Нет моста
через null/reversal, нет extrapolation на полбара; singleton/cap semantics — G2 gate. Первый бар и
sparse masks сохраняются из math. Скрытые anchors не расширяют scale.

### 4. Оформление и persistent версия

Предлагаемая policy: отсутствующий v1 style включает descriptor default; любой явный v1 color
сохраняет solid. Старый form сохранял defaultcolor при редактировании period, поэтому эвристика по
равенству цвета не восстанавливает намерение пользователя.

Period/source/params-only submit сохраняет schema и отсутствие output style; preview defaults не
становятся persisted color. Такой edit не отключает auto palette. Actual form→JSON→read проверяется
отдельно от resolver. Любой старый explicit color остаётся solid.

Автор рекомендует **instance2 с сохранённым legacy styles bag и presentation.outputs/fills** из
исследования §4: discriminated geometry и auto/solid mode, point size1..4, fill visibility/opacity/
color. Незаданные properties наследуют legacy/default; auto color обходит legacy solid и возвращает
descriptor palette. Per-output reset меняет только colorMode, сохраняя остальные patches. Два уровня
оформления — явный compatibility trade-off ради сохранения исходных v1 полей без потерь. Новый
validator ограничивает geometry/IDs/keys и scalar bounds; расширять schema1 нельзя.

Текущий v1 с requiredcolor не способен сохранить auto+width/opacity и полный fill/point scope. V2 —
только proposal до root contract review, хотя функциональный scope авторизован. Один integrator
атомарно обновляет exact validators → JSON/storage → Drive whitelist → UI. Первый advanced edit
может повысить только редактируемый instance; period/read/import/sync v1 не переписывают. Bounded v1
delete-style reset теряет независимые patches и не выдаётся за полную функциональность.

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
- [KLine empty companion меняет flat range через precision4] → effective owner/native Price sync
  policy с первого create, G7 native range equality tests; visible=false недостаточно.
- [Coordinate/heap cost] → visible-range painting, invalidation по data/style/camera/DPR, bounded
  resources.
- [Runtime objects попадают в backup] → strict scalar-only serializers и negative roundtrip
  fixtures.

## Migration Plan

Только план до G5/root contract review. Сначала v1 fixtures/numeric42; затем v1|v2 reader, strict
presentation validation, UI и JSON/Drive paths одним интегратором. Старые v1 остаются v1 на read/
import/period/sync. Для явного advanced edit — instance2 с точной копией legacy fields и новым
patch, без миграции остальных экземпляров. Рекомендуемый export: envelope2 для v1-only, envelope3
при любом instance2; reader1/2 принимает v1, reader3 — v1|v2. Это новое compatibility решение, а не
нынешний формат. Old-reader reject и sync fencing проверяются до production.

Unknown newer envelope/instance/fields отклоняются **до** projection/write/apply/upload/checkpoint;
sync сообщает unsupported/review-needed и не заменяет local/remote известным subset. Нельзя
продолжать sync, отбросив неизвестные поля. JSON/Drive projection roundtrip и zero-write spies
обязательны; live Drive не нужен. До принятия G5 ни v2 writer, ни envelope3 не внедряются.

Rollback render-only части удаляет owned resources/descriptor feature, оставляет numeric/profile
data. Rollback после v2 записи требует согласованного reader либо явного обратного export; молча
терять fill/default flags нельзя. Никакой Drive mutation в исследовании или для проверки fixture.

## Open Questions

Runtime решения зафиксированы integrator в `docs/TA_RENDER_IMPLEMENTATION_DECISIONS.md`. Actual
cross pixels, singleton/caps, fill/MTP paint, native create/precision и performance требуют своей
evidence; соответствующие native tasks остаются unchecked. G5/persistent compatibility ещё не
принято: v2 export/reader/writer не внедряются до отдельного решения. Source-only compiler не
закрывает actual paint/create gates и не доказывает Pine parity.
