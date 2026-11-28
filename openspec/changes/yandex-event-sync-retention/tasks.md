# Tasks

## 1. Смысловые события и scheduler

- [ ] 1.1 Закрепить существующий canonical selector/digest для
      camera/view/layout/settings/watchlist/ drawings, исправить обнаруженные ложные triggers
      clocks/quotes/sync metadata/draft; source unit проверяет каждую категорию и те же значения,
      README фиксирует причины публикации.
- [ ] 1.2 Подключить debounce750ms/max-wait5s и dirty continuation занятого writer; fake-clock unit
      проверяет burst, непрерывный ввод, busy, disable и local edit во время upload.
- [ ] 1.3 Разделить read-only inspect, upload и maintenance причины; unit проверяет нулевой upload
      при ticks/clock/checkedAt и unchanged digest, сохраняя получение чужой версии и recovery.

## 2. Идентичность, группы и cleanup

- [ ] 2.1 Сохранить normal UUID/shared test identity и группировать copy statuses; unit проверяет
      reload, новый test сеанс, смену режима и независимость двух normal клиентов; UI показывает
      current/previous, unresolved и pending cleanup без скрытия файлов.
- [ ] 2.2 Добавить чистый план accepted retired legacy/test candidates и protected set; unit
      проверяет exact ancestry/digest, отсутствие proof, чужой current, unresolved/pending/future
      файлы; документировать правила допустимости рядом с planner.
- [ ] 2.3 Выполнять cleanup только после full current verification с rescan и conditional delete;
      synthetic transport unit проверяет поздний файл, изменённый MD5, сбой readback, partial
      cleanup и сохранность двух полных версий, включая current/previous в одном контейнере.
- [ ] 2.4 Добавить optional v3 acceptanceProofs по замороженному union, strict bounds и canonical
      conflict detection; codec unit проверяет absent/v2 compatibility, old-reader fail-closed,
      inheritance и metadata rewrite без потери proofs; design фиксирует формат.
- [ ] 2.5 Захватывать original whole-binary legacy hashes каждого выбранного предка и original test
      SlotVersion hash только при explicit reviewed selection; unit проверяет snapshot pins,
      отсутствие auto-upgrade old UUID и повтор already-committed pending без нового capture.
- [ ] 2.6 Добавить cold-retry regression для подмены валидного legacy/test binary под прежним ID,
      отдельной подмены legacy предка и duplicate UUID; unit подтверждает zero DELETE для подмен,
      работу с original proof, iterative/cycle/10000 bounds и отсутствие unsafe truncation.

## 3. Конечное удаление и retry

- [ ] 3.1 Ограничить lock/network/readback общей deadline90s и единым abort; fake-clock unit
      проверяет stuck lock/fetch, disable/logout/account change и обязательный выход из busy.
- [ ] 3.2 Сохранить exact durable plan и idempotent retry с максимум3 автоматическими попытками;
      unit проверяет lost DELETE response, 404, changed candidate, reload и поздний callback другой
      операции; UI показывает ошибку/повтор без сброса auth и данных.

## 4. Интеграция

- [ ] 4.1 Интегратор выполняет pnpm check и pnpm spec:validate; reviewer проверяет protected set,
      auth preservation и multi-tab races, результаты сохраняются в verification.md.
- [ ] 4.2 Изолированный browser агент проверяет event-only публикацию по фактическим upload counts,
      группы реальных копий и конечное удаление/повтор; интегратор фиксирует before/after file
      graph, проверку current/previous payload и остаточные protected files в verification.md.

## Workflow follow-up

- Архивировать после приёмки реализации и подтверждённого сохранения пользовательских данных.
