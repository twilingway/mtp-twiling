# Source verification

26.11.2026; branch `feat/ta-state-oscillator-registration`, exactbase
`5d569c394ee3d8730af12c665aa956f290b3245e`, reviewed math cherry-pick `44c1eb4`
(`49bfcf77c9a5200f8bcaf6d70735bd167c500b5f`).

| Проверка                                 | Результат                                                 |
| ---------------------------------------- | --------------------------------------------------------- |
| Own registry source tests                | 7/7 PASS                                                  |
| Own production JSON/Drive tests          | 4/4 PASS                                                  |
| Own actual settings/library source tests | 4/4 PASS                                                  |
| Reviewed pure math tests                 | 19/19 PASS, folder diff пуст                              |
| Existing volume persistence tests        | 4/4 PASS                                                  |
| Existing volume settings tests           | 3/3 PASS                                                  |
| Full source compiler host/noEmit         | PASS, ровно1 virtual app-version module /2 string exports |
| Scoped ESLint/Prettier                   | PASS                                                      |
| Strict OpenSpec all                      | 46/46 PASS                                                |
| Git diff whitespace                      | PASS                                                      |

Всего41 focused source test PASS. Direct Node execution без subprocess test isolation; нет build.
Plain tsc --noEmit отдельно показывает2 baseline TS2307 из отсутствующего generated app-version,
который не создавался. Compiler host проверяет остальной реальный src без diagnostics filtering и
изменения strict flags.

Independent witness из read-only Git base:42 definitions/default instances/history и168 runtime
results на empty/ordinary/no-volume/sparse cases. SHA256
`610fd4c860f6ccc49bc80c7f1f29651a5983d75ce2630ff565f5ed81823afc0a` совпал после append3. Counts45
computed/46TA/50library проверены source tests, включая actual TerminalIndicatorLibrary. New
production modules23/55/114 nonempty lines, ниже500.

Только TSI/KST/Fisher registered. KST persisted flat9 scalar keys, tuples только math call. Fisher1
сохраняет length1 без metadata; runtime all-null/warmupnull/recursive seedBarsnull/alwaysUndefined
true. Shared old recursive history contract не расширен arbitrary literals; новое union точное.
Human RU/EN labels и exact10 новых Drive allowlist keys проверены.

Root gates: independent exact-source review, актуализация historical total42/43 acceptance
checks/native fixtures для45/46/50, native/browser на обеих engines, styles/panes/reload/Fisher1 и
последующие version/public gates. Native fixtures/root receipts/package/build/server/browser/Drive
accounts/push/merge/deploy не менялись. SAR/Supertrend math-only, DPO unresolved. Полный build/full
suite/browser PASS не заявляется.
