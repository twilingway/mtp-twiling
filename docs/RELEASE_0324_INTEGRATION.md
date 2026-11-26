# 0.3.24: Keltner Channels

Кандидат в отдельной ветке от main 0.3.23; не подтверждение публикации. Следующий main нельзя
публиковать до завершения public PWA acceptance 0.3.23.

## Изменение

Добавлен Keltner Channels: три линии Upper/Basis/Lower и прозрачная заливка между границами.
Настройки: длина 20, множитель 2, источник close, EMA включена, режим Average True Range, длина
ATR 10. Можно выбрать SMA вместо EMA и один из трёх режимов границ: Average True Range, True Range
или Range. Boolean сохраняется как boolean, выбор режима — точная canonical string.

Число вычисляемых TA увеличено с 50 до 51; с объёмом — 52, с четырьмя MTP — 56. Центральные ожидания
дополнены только KC и ключами useExponentialMa/bandsStyle. Старые исторические witnesses, параметры
и принятые математические kernels не меняются. Форматы instances/backup/DB прежние.

## Принятые исходники и предстоящие проверки

Source registration `caf00f8b73e84102428d13ef1508d320c0bc9157` прошла независимое ревью: 128 scoped
tests, 432 независимых numeric cases и 53 136 comparisons. Четыре сочетания PVO сохранены точно;
checked=false и три варианта границ прошли RU/EN actual-submit probes. Primary KC 35.0 проверен по
HTTPS и SHA256, см. KELTNER_PRIMARY_CAPTURE.json.

Полная интеграционная проверка: `pnpm check` 1131/1131, exit 0; OpenSpec strict 58/58, exit 0. Build
`e3e34d49e020e05d`, версия 0.3.24. Первоначальный check обнаружил одно устаревшее ожидание «KC не
зарегистрирован» в прежнем registration test: обновлена только ожидаемая mapping KC, проверка
отсутствия DC и точные first50/old47 witnesses сохранены. Финальный полный check прошёл.

Остаются native/product paint обоих SDK, шкала и курсор в price/own pane, hidden/remove, настройки
false/three choices после reload, заливки/слои, RU/EN mobile и сохранение старых 11 TA и рисунков из
публичной PWA.

Новые definitions неизвестны старому клиенту. Отдельные Git-source tests используют точный reader
опубликованной .23 (`62a1a36f2409911f6bdb029f37e0bfe14e852489`): он отклоняет все шесть KC
boolean/choice сочетаний с `unsupported-format`, не меняя входные данные. Старые 50 экземпляров
проектируются reader .23 и текущим reader точно одинаково. Это проверка pure reader, а не реального
Google или синхронизации двух устройств. Новых writer formats или DB migration этот кандидат не
вводит; G5 proposal остаётся отдельным.
