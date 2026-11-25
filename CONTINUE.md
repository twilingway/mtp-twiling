# Продолжение — mtp.twiling.ru

Сначала читать [HANDOFF_NEXT_SESSION.md](HANDOFF_NEXT_SESSION.md), затем AGENTS.md, TASKS.md и
практический план12пакетов `vps/artifacts/parallel-work-review/plan.md`.

Canonical: `D:\MySource\ReactJS\tradingview-personal`, ветка master. Не заменять актуальный src
старым staging. Сервер5210 уже работает; пользовательский Chrome сохранить.

Текущий build0.3.5 `8d7c16e44f955542`, check120/120 PASS; после последнего исправления React keys
повторно strict build, scoped lint/format и120/120 тестов PASS. Мобильный список и полноэкранный
поиск реализованы, изолированная визуальная проверка завершена в
`vps/artifacts/mobile-terminal-qa`:375/320/landscape, обе темы,27 просмотренных скриншотов,0 page
errors, профиль восстановлен. KLine importA применяется сразу; у LW параметры камеры восстановлены,
но импорт сокращает загруженный отрезок истории — P2 остаётся следующим hotfix. Полную исправность
импорта LW не заявлять.

Google Drive core в отдельном worktree/ветке feat/google-drive-sync, commit7f36691:36fake tests и
независимый review PASS. UI bridge, настоящий OAuth/Drive и два устройства не проверены.

Глобальный и проектный max_concurrent_threads_per_session=12. Текущая сессия по-прежнему принимает
только4total; для применения нового лимита нужен новый запуск и проверка actual tool cap. Новый
parallel-task-execution skill и DAG/file ownership готовы; не создавать фиктивные задания и
одновременных writers общих типов/контроллеров/сборки.

Исторические подробности Google Cloud, SSH/VDS/Mac и прежних проверок сохранены в
[docs/CONTINUE_HISTORY_2026_11_25.md](docs/CONTINUE_HISTORY_2026_11_25.md). Текущие незавершённые
пункты и разрешения сводятся в HANDOFF_NEXT_SESSION.md. Токены, .env и browser profiles не печатать.
