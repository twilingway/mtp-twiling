# 0.3.23: native TA, сохранение панелей и reader guard

Подготовка выпуска, не подтверждение публикации. Публичная/canonical версия пока0.3.22,
main131e38e81fe8b10a53132806c3ccbac29f4d33d6/build59e00dca6d4d2d16.

## Изменения

Добавлены SAR/Supertrend/ALMA/LSMA/Chandelier Exit:50 computed,51 technical entries с Volume, 55
library с4 MTP scripts. Старые45/47 definitions, параметры, styles, history и numeric results
сохранены независимыми Git-source witnesses. SAR рисуется крестиками, Supertrend — раздельными
ветвями/заливками; все5 сохраняют native-price policy после переноса в отдельную панель. Excessive
ALMA/LSMA work возвращает явный transient calculation-limit без усечения истории и изменения params.

Resize сохраняет порядок панелей и fresh untouched collapse/height/reorder предыдущих queued
действий. Runtime context отделяет resized IDs от baseline order, persistent layout прежний. 30px
collapsed strips не показывают ложные fallback tick labels; expanded meaningful ticks возвращаются.

Drive guard проверяет same-head и standalone publish/resolve payload до принятия/публикации,
останавливает unknown local association без default replacement. Пауза использует auth.suspend и
сохраняет valid Google credential с исходным expiry. Проверка формата читает JSON, без image
binaries. Поздняя гонка может оставить orphan blob: server CAS/zero-all-uploads не заявляются.

## Проверенное и следующие gates

- SAR/ST c14427f: independent9 groups +55 focused tests READY.
- ALMA/LSMA/CE edd9668: math88/registration9/settings4; independent50 numeric/99 preflight/9 actual
  submit probes, old47 witnesses и full-input costflow обоих adapters READY. Math780 blob IDs точны.
- Pane fix16a8601: independent10 probes +19 repeated tests READY; root integrated94/94 PASS.
- Compact axis13f3c27: actual isolated Chrome14 viewed/16 saved, both engines, dark/light,
  expand/precision/camera. LW native rounding при разной высоте до0.000505 обратимо.
- Reader guard8315/6651:73 новых и108 existing PASS; independent actual Auth+AES-vault7/7 PASS,
  ciphertext сохраняется, handles aborted, expiry не продлевается, другой owner/generation сохранён.
- Combined source50 до guard0d17cf1: полный check1026/1026, specs55/55, build2aed26fae5c28774 PASS.
  Новый объединённый check/build, fresh product browser и public release/PWA gates ещё впереди.

Final acceptance использует exact frozen source/build ID, оба native engines, native divider drag,
library/settings/reload/import, real Bybit spot/linear, MTP/drawing/cursor layers и mobile375 RU/EN
dark/light. Source probes и standalone native harness не заменяют эту проверку.

## Границы

LSMA length1 остаётся unresolved: official wrapper30.0 подтверждён, но anonymous TradingView требует
аккаунт для add study; numeric result не получен. Local min2 не выдаётся за Pine minimum. KC/DC пока
math-only; KC boolean/choice registration выполняется отдельно. Все127 TA не реализованы. Новых
instance2/envelope3/DB3 writers нет; G5 compatibility proposal отдельно. Real Google
OAuth/Drive/two-device, установленное окно PWA и физический телефон не проверены этим source этапом.
