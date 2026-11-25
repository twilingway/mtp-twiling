# Источники настроек

По прямому запросу пользователя перенесены общие правила из `games/towerdefander` и рабочего дерева
Piano Trainer `pt-agents/night-status-20261115`.

- Объединены `.agents/skills`; при совпадении выбран вариант Piano Trainer. Несвязанные с терминалом
  навыки хранятся для будущих задач и не применяются автоматически.
- Перенесены `.codex/config.toml` и настройки роли/делегирования, `.editorconfig`, Prettier и
  настройки VS Code без восстановления терминалов.
- Общие AGENTS/CODE_STYLE адаптированы: React + strict TypeScript, pnpm, ESLint/Prettier, OpenSpec,
  pure models/thin UI, небольшие модули, независимые review и визуальная изоляция.
- Сохранены `strict`, `allowJs:false`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `verbatimModuleSyntax`; frontend проверяется весь, включая адаптеры/сервисы.
- ESLint включает типизированные проверки, запрет any/ts-ignore, правила React hooks, consistent
  type imports и лимит500строк.
- Команды проверок согласованы под самостоятельный статический проект. Чужие порты5190/5191,
  игровые/MIDI/Phaser-параметры, ветки/PRномера, deploywatchers, `.env` и личные permissions не
  копируются как активная конфигурация терминала.
- При появлении remote проект использует ветки/PR/CI. Сейчас это самостоятельный новый локальный
  Git-репозиторий; доступ к прежним репозиториям не расширялся.

Миграция существующих русских строк в отдельный каталог локализации — дальнейшая задача; она не
подменяет текущую миграцию React/типов.
