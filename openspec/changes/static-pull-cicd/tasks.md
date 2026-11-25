# Tasks

## 1. CI и версия

- [x] 1.1 Реализовать hosted CI и PR version gate; проверить сценарии deploy-тестами.

## 2. Публикация и откат

- [x] 2.1 Реализовать exact-SHA watcher, allowlist упаковку и public health; проверить отказ CI,
      traversal, symlink, checksum и rollback тестами.
- [x] 2.2 Добавить Linux systemd/nginx и runbook; проверить bash syntax и контракты файлов.

## 3. Интеграционные проверки

- [x] 3.1 Выполнить deploy-тесты, pnpm check и pnpm spec:validate; зафиксировать ограничения.

## 4. Ограниченная сборка VDS

- [x] 4.1 Сравнить полный pipeline и прямой builder на чистых и повторных generated outputs по
      version/buildId и hashes каждого manifest asset; зафиксировать метод и результат.
- [x] 4.2 Заменить повторные проверки VDS на frozen install + прямой builder; Linux black-box
      тестами проверить оба CI gates, ошибку install/build, cooldown, immutable release и public
      health.
- [x] 4.3 Обновить runbook и прогнать полный check, strict spec validation и Linux deploy-тесты.

## Workflow follow-up

- [x] Проверить локально Linux normal postinstall + полный build и ignore-scripts + прямой builder
      на независимых холодных stores, затем повторные сборки: metadata и hashes63 assets должны
      совпадать; native pinned esbuild запускается без postinstall. Обновить controller contract,
      выполнить check/spec и Linux deploy-тесты; реальный VDS retry требует отдельного
      recovery-плана.
- [x] Измерить ограниченный local cgroup192/240/0 с настоящим Node-controller, cold pnpm install,
      builder и packaging; проверить workers1 отдельно от heap flags, затем cold repeat финального
      кода. Зафиксировать точный scope offline GitHub/public fixtures и отличие от live VDS proof.

  Проверено 26.11.2026: normal/ignored cold/repeat Linux63/63 hashes совпали; native esbuild0.28.2
  работает без postinstall, missing binary даёт exit1 без release manifest. Workers1+ignore-scripts
  прошёл cold local aggregate cgroup дважды; финальный controller37.439s, memory.peak203272192B,
  max/oom/oom_kill0. PNPM_MAX_WORKERS меняется только у pnpm child, NODE_OPTIONS не меняется. Полный
  check479/479, Linux deploy27/27, strict spec29/29.

- [x] Проверить optional SHA pin: malformed, expected A/current green B без query/build/activation,
      успешный pinned A и смену main перед активацией; прогнать deploy/check/spec на изолированной
      ветке и подтвердить неизменный PWA buildId.

  Проверено 26.11.2026: pnpm check 447/447, WSL Ubuntu Node22.22.1 deploy-тесты 27/27 без skip,
  strict spec25/25. PWA0.3.15, buildId652005923294e034; src/public/package не изменены.

- Создать remote/private GitHub repository и настроить доступ после интеграции.
- Проверить VDS DNS/TLS/routes, установить watcher и выполнить публичный SHA smoke.
- Проверить обновление PWA отдельным визуальным reviewer до объявления deploy завершённым.
- Архивировать change после независимого review и подтверждённой публикации.
