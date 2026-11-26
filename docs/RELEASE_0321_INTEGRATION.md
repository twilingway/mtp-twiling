# Версия 0.3.21: объёмные индикаторы

Ветка `feat/release-0321`, worktree `vps/artifacts/release-0321-worktree`. Проверенный source cut
`298101c77053364e93cf5f21389c81702b5ff2ae`, build `670626838ab63513`. Эта версия ещё не
опубликована. После браузерной приёмки включён main0.3.20; слияние меняет только документы и
ancestry, production inputs остаются прежними.

## Состав и совместимость

Добавлены CMF, Chaikin Oscillator, Elder Force Index, Ease of Movement, Percentage Volume
Oscillator, Negative Volume Index и Positive Volume Index. Теперь 42 вычисления, 43 доступных TA с
объёмом и 47 записей библиотеки с четырьмя MTP. Прежние 35 определения, defaults, order и result
shapes совпадают с независимо восстановленным frozen contract220b227.

PVO содержит oscillator/signal/histogram, NVI/PVI — index и EMA, остальные четыре — value: всего 11
новых рядов. Defaults, первичные источники и математические пределы описаны в
`TECHNICAL_VOLUME_FLOW.md` и `TECHNICAL_VOLUME_REGISTRATION.md`. Полная Pine runtime parity не
заявляется; sparse accumulation и binary64 пределы явно отделены от проверенных dense формул.

Все семь требуют хотя бы одного конечного положительного объёма во входной истории. Без него runtime
возвращает null-ряды и result-only `unavailableReason:volume-unavailable`, без выдуманного
NVI/PVI1000. Pure math не менялась; это отдельная availability policy. Прежние 35 не получают новое
own-property. Compound history сохраняет cumulative+EMA, seeds и convergence отдельно.

Строгий choice EMA/SMA проходит UI, JSON и Drive как строка. Null/unknown/extras отклоняются
production validator до Drive projection. Allowlist расширена ровно `divisor`, `emaLength`,
`oscillatorAverage`, `signalAverage`; новые result metadata не становятся persisted params.

## Проверки исходников и adapters

- Полный `pnpm check`:761/761; strict OpenSpec44/44.
- Root native renderer suite:20/20; actual adapters отображают все42 определения. Отдельно проверены
  11 пустых output при volume0 и восстановление реальных положительных данных без сброса камеры или
  лишних primary writes.
- Независимый registry review c485150:95 focused и24 Drive PASS, material findings нет;
  `vps/artifacts/volume-registration-readonly-review.md`.
- Логи: `vps/artifacts/release-0321-integration-check.log` и
  `vps/artifacts/release-0321-integration-spec.log`.

## Отдельная браузерная приёмка

Fresh worker, собственные Chrome/профиль/managed server5227, без обычного Chrome или реальных
bank/Google credentials. Реальный Bybit BTCUSDT spot/perpetual: REST200, WS и оба Canvas. Все семь
добавлены через UI и все 11 рядов реально осмотрены; прежние RSI/DMI/EMA работают.

PVO7/19/5 проверен во всех четырёх сочетаниях EMA/SMA: strings, redraw/reopen/reload. Проверены
CMF23, Chaikin4/17, EFI17, EOM11/divisor25000, NVI89 и PVI144. Общая нижняя панель, порядок,
collapse/visibility, стили, native resize/wheel, JSON export/import и возврат provider linear→spot
сохраняют ожидаемые параметры и layout. Настройки/sidebar/reorder не добавляют запросов истории.
Камера сравнивалась после settle с одинаковыми bars/last timestamp/plot width/barSpace/pixel gap.

На375×812 RU/EN light/dark labels/select/options/Save доступны, checkbox16×16, overflow нет.
Сохранены и реально просмотрены все28 screenshots; JS/CSP ошибок нет, только два meta-deprecation
warnings. Отчёт и manifest: `vps/artifacts/release-0321-visual-qa`. Собственные Chrome/CDP9327 и
server5227 закрыты, профиль сохранён.

Browser gate отсутствующего объёма не выполнялся: он покрыт source/native fixtures, реальные
котировки для этого не подменялись. Настоящие Google OAuth/Drive и банк не проверялись; загрузка
публичного GIS SDK не считается входом или синхронизацией. Live public PWA update этой версии
остаётся отдельным gate после CI и автоматического деплоя.
