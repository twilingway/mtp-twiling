# Камера и синхронизация Drive

## Защита входящего снимка

Нативный pan/zoom не меняет React preferences. Поэтому прежняя portable revision могла остаться
прежней, пока Google download уже завершался или входящий import ждал IDB commit.

Теперь `ChartGestures` отмечает pointer start/move, pinch, wheel и double-click в capture, до native
mutation. ChartNavigation отмечает свои команды до RAF. Публичные fit/focus обёрнуты таким же user
epoch. Hover и движения crosshair без нажатия не являются intent. Чисто вертикальное движение
консервативно инвалидирует stale incoming, но не объявляется изменением X-камеры.

`onCameraIntent` синхронно вызывает `DriveCoordinator.localIntent()` — только revision++, без
upload. Действующие guard проверки после network, очереди, saveView и в transaction видят её до
первого RAF. Когда import/recovery уже владеет canvas, capture останавливает native input до
мутации; доступ к recovery/account controls сохраняется.

`controller-camera-sync.ts` хранит scoped pending intent в WeakMap. Drive не начинает новую операцию
между intent и готовым сохранением: иначе poll, начавшийся уже после revision++, мог бы прочитать
старый сохранённый view. Click без движения, cancel/destroy или успешное сохранение освобождают
соответствующий scope. Старый owner/UID/viewKey/session/adapter не блокирует новый.

## Фактическое сохранение

`UserCameraEvents` объединяет KLine OnZoom/OnScroll и LWC visible logical range callbacks только с
пользовательским epoch. Проверяется изменение X camera barSpace/rightOffset с допуском к
floating-point шуму. Quote-derived anchor/from/to сами не служат dirty-критерием.

После 250 мс тишины observer ждёт два RAF и читает готовый ChartView. Неготовый/ошибающийся readback
повторяется максимум шесть последующих кадров. Programmatic setData/updateBar/setView сами не
открывают epoch; synchronous callbacks в них подавлены. Initial fit, restore, quote и resize без
действия пользователя ничего не публикуют. Все таймеры/RAF отменяются при destroy, wrapper retired.

Helper проверяет source owner/UID/viewKey, bank session, chartRevision, owned instance, alive,
retired/persistView/historyViewReady/import/recovery. Готовый view копируется до async очереди,
затем сохраняется через существующий saveChartView для захваченного owner/key. Повторного чтения
live chart после ожидания нет: quote или setData не могут заменить уже подтверждённую геометрию.
Dirty/обычный Drive debounce включается лишь после успешной записи.

Сбой storage/readback даёт одно RU/EN уведомление и сохраняет scoped pending, приостанавливая sync
до нового успешного изменения вида или замены source. Автоматических бесконечных retry нет.

## Экспорт без quote echo

Даже без native dirty прежний periodic/focus export делал flush → saveView и каждый раз записывал
живой anchor/from/to от новых свечей. Это меняло digest без пользовательской правки и могло
создавать лишние снимки/конфликты.

Drive bridge теперь ждёт `flushCamera(controller)`, затем вызывает существующую transfer queue:
`exportBackup(false, { captureView: false })`. В ней сохраняются editing/client/storage flush и
owner/session validation, но live view не захватывается заново. Синхронизируются уже сохранённые
пользовательские виды. Manual JSON, pagehide и обычный flush имеют прежний default captureView=true.

В controller изменены только optional export/flush options. setPreferences, depth carry,
services/chart-camera, candle/history/bank код и Backup allowlist не менялись. Для соседнего depth
helper `controller-camera.ts` имя свободно; camera sync намеренно находится в отдельном модуле.

## Проверки и ограничения

`test/camera-intent.test.mjs` проверяет реальные observer/helper/controller/coordinator модули с
fake native geometry, deterministic RAF и memory transport/IDB boundary: 13 сценариев, включая
до-RAF download/commit race, start-after-intent poll, pending durable write, captured-view snapshot,
quote-only polling/no conflict, manual capture, wheel/pinch, owner/session/UID/source/retired guard,
bounded failure и cleanup. Существующий lifecycle regression fixture дополнен session identity.

25.11.2026 первый `pnpm check` PASS 325/325 (format/lint/strict TS/build/test), build
`e11efedfce4b1847`. После добавления уточнённого RU/EN сообщения повтор прошёл format/lint/TS/build
`581ce5c05c5f386b` и 324/325 тестов: только старое ожидание fixed1700ms при debounce1500ms не
дождалось crypto под параллельной нагрузкой. Его event-driven исправление выполняется отдельным
владельцем `test/drive-coordinator.test.mjs`; этот файл здесь не изменён. OpenSpec strict PASS
18/18.

Root выполняет финальный общий check после интеграции соседних commits. Canonical/runtime/profile,
реальный Google OAuth, публикация и визуальная проверка этой задачей не выполнялись. LWC restore и
KLine canvas resize остаются существующими реализациями. Синхронизируется только имеющийся X-view
Backup1; вертикальная шкала Y не добавлена и не обещается.
