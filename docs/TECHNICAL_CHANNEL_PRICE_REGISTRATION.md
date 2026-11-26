# Регистрация ALMA, LSMA и Chandelier Exit

Source-only этап от `7cc9df914d78dc3da545fc17e11d5baa268fe490`. Reviewed math
package780e9c5287153021b516b472fb1282b22f3b59a4 перенесён byte-identical: все6 modules, math88
tests, исходные math docs/OpenSpec. Эта интеграция регистрирует только3 IDs. KC/DC остаются
math-only до отдельных boolean/choice и displayOffset gates.

## Inputs и outputs

Три definitions добавлены строго после SAR/ST:50 computed,51 technical entries с Volume,55 доступных
entries с четырьмя MTP scripts. Global counts в прежних fixtures намеренно не редактируются: root
обновляет их один раз после integration.

| ID              | Defaults и controls                                  | Outputs             |
| --------------- | ---------------------------------------------------- | ------------------- |
| alma            | length9, offset0.85, sigma6; фиксированный close     | value               |
| lsma            | length25, offset0, sourceclose; все прежние8 sources | value               |
| chandelier-exit | length22, atrLength22, multiplier3                   | longExit, shortExit |

ALMA floor остаётся optional pure API и не становится builtin input или persistent key. LSMA offset
оценивает текущую fitted line на другой x coordinate, timestamps не сдвигаются. LSMA length1
unresolved: локальный min2 показан в settings и не объявляется Pine minimum. CE — builtin, без
Everget sourceClose/ratchet/direction/signals. Обе exit lines существуют одновременно, weakening
stops не маскируются.

Presentation всех3 — solid line, break gaps, native-price, width1, без fills/markers/новых styles.
ALMA/LSMA/CE long используют стандартный текущий plot-blue `#2962FF`; CE short имеет explicit
primary `#FF6D00`. Источник первых plots не задаёт цвет, поэтому blue не выдаётся за новый explicit
source literal. После переноса в lower pane сохраняется native-price policy; actual native/browser
acceptance выполняет root отдельно.

## Математика и history

ALMA/LSMA: full contiguous window, warmup=L, finite lookback=L, exact-after-lookback. CE:
warmup=atrLength, recursive/full-input-dependent, seed
`available-extrema;tr-fallback;full-window-atr-rma`; extrema period не подменяет ATR readiness. Нет
дополнительного warmup mask поверх reviewed math.

ALMA получает close напрямую. Новый LSMA source adapter использует принятый convex `prices` из
byte-identical package, чтобы hl2/hlc3/ohlc4 сохраняли MAX/subnormal values и не создавали0 из
underflow. Старый `priceSource` и прежние47 результаты не менялись. Source selector и offset
проверены против accepted math, independent rational OLS ledger и signed MIN/MAX constant fixtures.

## Calculation-limit

`technicalCalculationUnavailableReason(instance, barCount)` — O(1), runtime-only. Для ALMA/LSMA
точная проверка `max(0,N-L+1)*L > 50000000`; все3 дополнительно соблюдают reviewed bars<=1000000.
При превышении kernel не вызывается, metadata не вызывает пустые kernels, и runtime возвращает
прежний computed result container с `unavailableReason:"calculation-limit"`, полными timestamps и
dense null outputs. Цены/params не изменяются; история не урезается. Это ресурсная недоступность, не
warmup и не mathematically alwaysUndefined. Неожиданные ошибки kernel не перехватываются catch-all.

Тот же helper в legend и settings показывает RU/EN объяснение: «Расчёт слишком большой для
устройства. Уменьшите период или глубину истории.» Settings оценивает текущий valid draft и
разрешает сохранить допустимые дорогие params. Params/history после уменьшения нагрузки
восстанавливают реальные outputs; перезагрузка пересчитывает status. Никаких runtime flags в
preferences/DB/backup нет. Existing `volume-unavailable` и legacy result shape сохранены.

Exact boundary test при L1000: N50999 даёт50M и вызывает kernel; N51000 даёт50,001,000 и не вызывает
его. Boundary проверен spy, а не дорогим50M benchmark. Реальный recovery: N16000/L10000
даёт60,010,000 и null; N10000/L10000 даёт10,000 и один ready output; смена length9 на полной истории
восстанавливает реальные ALMA/LSMA. Другой EMA продолжает считаться. Cache по params и setData
invalidation не менялись. Эти проверки не доказывают полный frame/device budget для разрешённых50M.

## Persistence и совместимость

Instance schemaVersion1 неизменен. Shared params allowlist Drive расширен только `offset sigma`;
exact per-definition keys проверяются до projection. Floor, source для ALMA, CE community params и
runtime result/status fields отклоняются. Own pane, visibility и все прежние
color/width/opacity/lineStyle round-trip через JSON/Drive.

Old47 definitions prefix, defaults, custom instances/styles, history и полные numeric results
сопоставлены с Git7cc9df9. Renderer/data bridge/native/camera/cache/history loading и build files не
редактировались. Котировки и Pine source не сохранялись в artifacts/repo.

## Primary evidence и проверки

`CHANNEL_AVERAGE_PRIMARY_CAPTURE.json`: три public endpoints, HTTP200, TLS default
CERT_REQUIRED/check_hostname без proxy/insecure flags; hashes/versions совпали с780e9c5. Сохранены
только metadata/color tokens, не Pine source. Captured26.11.2026 03:02:14–15UTC. Скрипт
`test/helpers/channel-primary-registration.py` повторяет только эти анонимные GET.

Source tests: math88/88, registration9/9, settings/library/status4/4 PASS. Baseline pane-layout7/7,
native geometry4/4 PASS. Прежние trend-price settings4 behavior tests PASS; один прежний global
count assertion ожидает52 вместо55 и намеренно оставлен root для общей count migration. Whole-source
strict virtual host, scoped ESLint/Prettier, OpenSpec55/55 PASS. Полные команды и границы — в
verification change.

Нет app build/prepare-version, browser/real-device evidence, Google API, публикации или изменения
root dirty package.json. Перед включением нужны независимое source review и root native/browser
gates.
