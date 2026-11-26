# Verification

Дата:26.11.2026. База:50b5873778fa442fce3266c2f9882a59d231ab38. Ветка ta-channel-average-math,
изолированный WT artifacts/ta-channel-average-math.

| Проверка                         | Итог                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Focused Node source tests        | 81/81 PASS; штатный isolation дал spawn EPERM, повтор с --experimental-test-isolation=none PASS |
| Whole-source strict compilerhost | PASS; только виртуальные APP_VERSION:string/BUILD_ID:string при absent generated baseline       |
| Scoped ESLint                    | PASS, без warnings                                                                              |
| Scoped Prettier                  | PASS                                                                                            |
| Strict OpenSpec all              | 48/48 PASS                                                                                      |
| Diff whitespace/scope            | PASS; только новые owned source/tests/docs/OpenSpec                                             |
| Primary source verification      | Python default TLS;5 builtin hashes плюс TradingView/ta/11 и official reference payload в docs  |
| Production module cap            | Максимум202 непустые строки, все меньше500                                                      |

Registry, shared types, persisted schema, UI/native, cache/Drive, package/version/build, generated
source, assets и публикация не менялись. Node_modules — read-only junction canonical dependencies;
установка не запускалась. Новых агентов нет.

LSMA length1 остаётся явным local unsupported/unresolved случаем. Pine skip-na/startup runtime,
multi-timeframe/realtime и native/browser parity не заявлены. Donchian display offset и KC/DC fill —
отдельные renderer gates. Builtin Chandelier — только две simultaneous exit-линии, без community
ratchet/direction/signals.

Русские docs/spec сохранены прямой UTF8 записью без BOM; после обнаруженного дефекта shell pipeline
выполнена полная перезапись и readback, без question-mark replacement runs.
