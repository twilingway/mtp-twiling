# Tasks

Research закончен отдельно от реализации. Runtime compiler реализуется в отдельной ветке; решения и
проверки: `docs/TA_RENDER_IMPLEMENTATION_DECISIONS.md`. Native и persistent gates остаются
отдельными незавершёнными задачами.

## 1. Решения и контракт — C

- [x] 1.1 Принять implementation contract G1–G4/G6/G7 отдельным decision record: cross/linebr/
      fill/palette policy, renderVersion2 и Price sync; проверить primary evidence. Actual paint/
      create gates закрываются в 2.3/3.3/6, не выдавать statictrace за их выполнение.
- [x] 1.2 Сохранить numeric42/v1 fixture corpus и expected hashes без computed render metadata;
      проверить source-only contract test, не генерировать expected из новой реализации.
- [x] 1.3 После 1.1 добавить typed descriptor/compiler с graph/null/length validation и palette
      resolver; проверить source-only geometry/palette tests и frozen numeric42 fixtures.
- [x] 1.4 Документировать принятый contract/limits и точные новые ownership paths; проверить scoped
      Prettier и strict OpenSpec, обновить G decision record.

## 2. LW — L, после 1.3

- [ ] 2.1 Реализовать owned cross/linebr primitive с native numeric carrier; проверить mock options,
      segment/gap/singleton geometry, scale include/exclude, dispose и absence per-segment growth.
- [ ] 2.2 Реализовать normal drawBackground fills по paired anchors; проверить
      firstbar/reversal/null, pane/DPR/clipping tests и отсутствие body/direction scale carriers;
      обновить renderer docs.
- [ ] 2.3 Проверить tiny-fixture actual LW paint в изолированном UI review, включая MTP/grid/cursor;
      сохранить SHA/version/screenshots и закрыть engine-specific G2/G3 evidence.

## 3. KLine — K, после 1.3

- [ ] 3.1 Реализовать cross custom draw и adjacent linebr, palette callbacks; проверить figure keys,
      current/prev-null colors, scale, no connectors и bounded registry slots в native tests.
- [ ] 3.2 Добавить fill companion runtime context и отрицательный layer, без hidden figures;
      проверить reverse/gap geometry, stale calc callbacks, teardown/owner isolation; обновить docs.
- [ ] 3.2a Обеспечить Series.Price class defaults owner+companion до create sync, без explicit
      precision/min/max/shouldOhlc overrides; сохранить legacy42 path. Проверить sequence/flag trap
      из probes/kline-precision-probe.mjs, фактическую effective policy, не только descriptor.
- [ ] 3.2b Выполнить actual SDK create/sync/override и native calcRange tests: native6/8, flat/узкие
      цены, precision6→8→6, повторный reconcile, hide/show/collapse/remove, без/с companion;
      сравнить весь range/axis object. Проверить отсутствие SAR/ST figure values при hide/collapse.
- [ ] 3.3 Проверить tiny-fixture actual KLine paint с negative layers/grid/MTP и singleton gap;
      сохранить SHA/version/screenshots и закрыть engine-specific G2/G3 evidence.

## 4. Persistent/UI — P, после 1.3 и отдельного G5 approval

- [ ] 4.1 Зафиксировать instance-v2/export-envelope/old-reader/rollback решение; проверить exact
      discriminated contract из исследования §4 и compatibility trade-off legacy bag + presentation.
      V1-auto+patch gap назвать явно; до root review writer не внедрять.
- [ ] 4.2 Атомарно обновить union/exact validators/JSON/storage/Drive whitelist с сохранением v1
      reader; проверить v1/v2 roundtrip, unknown keys/versions/accessors/non-finite negative
      fixtures до записи. Для unknown newer sync — zero projection/write/upload/checkpoint.
- [ ] 4.3 Добавить явные default/solid/reset и fill controls в settings/actions без implicit
      rewrite; проверить period-only старый style остаётся solid, customcolor отключает palette,
      reset сохраняет остальные настройки; обновить migration docs и UI evidence.
- [ ] 4.4 Проверить actual form→JSON→read: period-only absent-style остаётся absent/auto и v1,
      explicit oldcolor остаётся solid; auto+width/opacity и crosssize/fill patches roundtrip v2;
      per-output reset меняет только colorMode. Добавить JSON/Drive whitelist fixtures для v1-only
      envelope2, mixed v1/v2 envelope3, old-reader rejection и неизвестного newer remote до sync.

## 5. Registry — R, после 1.3, 2.3 и 3.3

- [ ] 5.1 Подключить reviewed SAR/ST math с overlays и правильными plot/internal/fill IDs, без
      value/ direction/body visible plots; проверить defaults/output keys/history/sparse contract и
      frozen42.
- [ ] 5.2 Проверить отдельные registration counts и serialization mapping; TSI/KST/Fisher интеграцию
      сверить с её владельцем, DPO unresolved не регистрировать; обновить catalog/status docs.

## 6. Интеграция — Q, после 2–5

- [ ] 6.1 Выполнить actual browser matrix исследования §6 на обоих engines, включая old42/MTP,
      linear/log/inverted scale где поддержано, light/dark/DPR1/2/mobile и engine switch; приложить
      exact candidate/fixture SHA и снимки, не заменять paint DOM проверкой.
- [ ] 6.2 Измерить old42 baseline и SAR/ST worst-case 10k/100k/100 instances, frame/heap/dispose;
      проверить согласованный budget и O(visible) painting, записать ограничения.
- [ ] 6.3 Выполнить согласованные project checks, review диффа и source/licence boundaries; строгий
      spec validation и browser/performance evidence должны пройти до release decision.

## Workflow follow-up

- Архивировать после реализации/приёмки; research не архивировать как shipped capability.
- Commit/merge/push/deploy выполнять только в отдельно разрешённом integration/release scope.
