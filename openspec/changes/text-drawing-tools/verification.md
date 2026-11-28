# Verification

Source tests покрывают десять типов, strict validation, clipboard/backup/Drive, multiline, цены
собственных якорей, независимость clone, table bounds и транзакции Save/Cancel. Независимый reviewer
нашёл ошибки clone/caption/table и подтвердил их исправление.

Оба SDK и темы проверены в изолированном браузере. Начальные PriceLabel/PriceNote P2 устранены:
повторная проверка build `cab563ee11b26859` подтверждает native создание и редактирование на desktop
и mobile390. Физический телефон не использовался.

Checkpoints и ссылки на ignored артефакты:
[release verification](../../../docs/RELEASE_0349_INTEGRATION.md). Общий CI и финальный smoke
отслеживаются в PR32.
