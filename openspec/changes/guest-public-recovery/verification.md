# Verification

## Происхождение и scope

База `de0f42de18645d95e828a4e9c0598c28db3a1e70`, ветка `fix/guest-public-workspace-recovery`,
worktree `D:/MySource/ReactJS/vps/artifacts/guest-public-recovery-worktree`. Контракт согласован
координатором до реализации. Это source-only пакет; version/package/lock, provider/client
implementation, runtime, server/nginx, Chart/Indicator компоненты и WatchlistSectionMenu/CSS не
менялись.

Реальные Chrome, IndexedDB/vault пользователя, процессы и сеть не использовались. Установленные
зависимости читаются через worktree junction; ignored app-version готовится штатным typecheck.

## Контракт

- Exact raw guest → physical profile-v2:public, только anonymous public bootstrap перед
  candidate.start.
- Existing v2 ready marker не отменяет проверку. Пустыми считаются только известные ready-marker и
  строго пустой bootstrap watchlist/market. Любой layout, даже defaults/{}, означает occupied.
- Preferences/drawings/images/history/coverage и decision marker записываются одной RW транзакцией;
  source неизменён. Occupied/source-empty markers блокируют неожиданный повтор после очистки public.
- Source reads используют exact keys, prefix key ranges и image ownerSymbol index. Target occupancy
  сканирует preference keys, без чтения чужих значений. Public-v1 prepare также стал scoped; bank
  migration не изменена. Vault/session/device key values новые helpers не читают.
- Quota/corrupt/abort не оставляют частичной копии/success marker. При valid lifecycle ошибка
  adoption не блокирует public bootstrap: показывается recovery сообщение и остаётся ручной экспорт
  без истории.
- Только реально пойманная quota adoption включает cache-port fallback для пустых public
  snapshot/quote cache. Nonempty/user writes, bank и non-quota ошибки не маскируются. Этот путь не
  гарантирует bank persistence при полной quota. Он предотвращает повторную блокировку пустым public
  cache.
- Download callback вызывается после guard, после DB/Blob await. Реальный переход до установки
  client отменяет candidate; после его успешной установки отменяется лишь устаревшее recovery
  warning.

## Проверки исходников

Команды: `pnpm.cmd typecheck`, полный source ESLint `--max-warnings 0`, scoped Prettier,
`node scripts/spec.mjs validate --all --strict`, `git diff --check`.

Source suite использует production TypeScript/storage-db/TerminalSession/MarketClient с заменённой
native IndexedDB boundary и транспортом банка. Новый DB fixture моделирует serialization RW,
Abort/Quota и native-commit границу, протоколирует value reads. Это не реальный Chrome IndexedDB.

```text
node --test --experimental-test-isolation=none test/guest*.test.mjs test/provider-storage-v2.test.mjs test/technical-provider-portability.test.mjs test/lifecycle.test.mjs test/watchlist-layout.test.mjs test/portable-import.test.mjs test/drive-import-abort.test.mjs test/watchlist-sections*.test.mjs
```

Лог: ignored `artifacts/guest-public-source-tests.tap`. Process isolation отключена из-за sandbox
`spawn EPERM`; тестируемый production код не подменён. Финальный совместный запуск: **96/96**.
`pnpm.cmd typecheck`, полный source ESLint, scoped Prettier и `git diff --check` прошли; strict spec
validation: **39/39**. Все production-файлы укладываются в ограничение 500 непустых строк.

Проверены .17 KLine/range180/light/gridfalse/font13; ready-marker + empty bootstrap; все категории
занятости, включая defaults; повтор/очистка; concurrent DB writers; quota/corrupt/abort до commit и
после native commit; сохранение source bytes/Blob/history и других owners; отсутствие private value
reads; raw guest JSON export/import; история без чтения payload при unchecked include-history;
owner/import/profile/session bounce до download, включая последний Blob await; RU/EN UI события;
ordinary async selection/own owner+revision commit; отмена late warning; текущий public и
последующий bank activate при работоспособной bank persistence.

Quota regression сначала воспроизводит отказ без wrapper, затем проверяет узкую корректировку.
Classifier отдельно исполняется в VM с другим Error constructor и принимает DOMException напрямую.
**Native Chrome quota, реальное скачивание и визуальная QA пока не проверены.**

## Pending browser verification

1. Только свежий изолированный тестовый профиль/контекст и контролируемая сборка координатора. Не
   использовать обычный Chrome, реальные bank sessions/vault или данные пользователя.
2. Seed raw guest со значениями выше и synthetic portable/history/coverage, public ready-marker с
   empty bootstrap. Запустить, проверить видимые KLine/180/light/gridfalse/font13, данные и source
   byte/hash invariance; повторный запуск не создаёт duplicate images/history.
3. Seed public defaults или изменённый workspace. Проверить отсутствие автозамены, recovery card,
   RU/EN предупреждение. В offline режиме скачать `mtp-before-update-YYYY-MM-DD.json` без истории,
   проверить содержимое и отсутствие profile-v2:guest marker; отдельно include-history.
4. Сохранить текущий synthetic public через Экспорт, затем явно импортировать старый файл; проверить
   восстановление настроек и сохранённый guest source. Bank-mode UI не должен показывать recovery.
5. На 360px mobile и desktop проверить светлую/тёмную тему, длинный текст, фокус/клавиатуру,
   отсутствие горизонтального overflow, реальный download. DOM/SSR проверки не заменяют эти пункты.
6. В безопасной isolated harness проверить native browser DOMException/IDB quota event shape:
   rollback большой adoption, явное сообщение о несохранённом переносе, доступный export без
   истории, отсутствие success marker, рабочий пустой public bootstrap. Не заполнять реальное
   пользовательское хранилище. Пустой cache fallback не должен скрывать nonempty/bank/non-quota
   ошибки.
7. Задержать DB/Blob чтение и выполнить import/profile switch: нет старого download/late warning.
   Обычный выбор инструмента во время history await сохраняет установленный client. Abort до
   adoption commit не оставляет copies; abort после commit не выдавать за rollback.
