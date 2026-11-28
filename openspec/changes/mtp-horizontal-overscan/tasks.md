# Tasks

## 1. Контракт и точный буфер

- [x] 1.1 Разделить core/capture и адаптивный X-запас; unit проверяет реальные индексы, границы
      истории и 4 Mi-pixels/4096 px.
- [x] 1.2 Реализовать Worker paint без изменения core; command/pixel tests проверяют phase,
      3000/3001, caps/joins, alpha и дробный DPR.
- [x] 1.3 Обновить описание frame-контракта и проверить build/version mismatch fallback.

## 2. Ранняя подготовка и непрерывные края

- [x] 2.1 Запускать bounded refill до исчерпания запаса; unit проверяет covered-prefetch, 150 ms
      cap, one in-flight и отсутствие N-обхода на кадр.
- [x] 2.2 Заменять любой реально uncovered partial текущим coarse; тесты проверяют полосу 1 px,
      нулевое покрытие, отсутствие double alpha и pending до exact.
- [x] 2.3 Сохранить reversal/source/reset/DPR/disable/destroy guards; scoped lifecycle tests и
      независимое ревью PASS.

## 3. Интеграция и видимая проверка

- [ ] 3.1 Пройти typecheck/lint/format, полный check и strict OpenSpec; сохранить точный
      source/build checkpoint.
- [x] 3.2 Измерить actual-canvas core pixel equality и новую стоимость paint/ready latency на ПК;
      проверить медленный pan, быстрый jump, разворот и отсутствие полосы.
- [x] 3.3 По актуальному указанию пользователя выполнять проверку на компьютере, включая мобильную
      эмуляцию и настоящий OffscreenCanvas при DPR 2.75. Физический телефон пользователь забрал; не
      подключать его и не выдавать эмуляцию за проверку на устройстве.

Проверенный MTP checkpoint: source `b0c9098`, build `a2356f2e259e0212`. Отчёт:
`artifacts/mtp-horizontal-overscan-qa/runs/a2356f2e259e0212/report.json`. 24/24 pixel cases: 0 RGBA
differences; 106 кадров жестов без пустого MTP. Новые времена измерены при параллельной валидации,
без вывода об ускорении. Общая релизная сборка и её smoke остаются отдельным пунктом 3.1.

## Workflow follow-up

- PR и зелёный CI exact head до merge; main CI и строгая проверка публикации после merge.
