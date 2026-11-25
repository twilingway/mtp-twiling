# Версия 0.3.19: интеграционная проверка

Изолированная ветка `feat/release-0319`, worktree `vps/artifacts/release-0319-worktree`. Она
содержит следующую версию после опубликованной0.3.18. Публичный main остаётся `3a31c02` до
завершения приёмки этого пакета.

## Состав

- Разделы котировок: исходный0f95648 → интеграционныйe21f566. Ledger сохраняет заголовки, ручной
  порядок и collapse, удаление раздела возвращает инструменты на верхний уровень. Сортировка
  действует внутри групп; drag заголовка переносит весь раздел. Реальные MarketRow не заменяются
  фиктивными инструментами.
- Границы операций: исходный1152ca6 → интеграционныйc7413e3. Завершившийся import и возврат к
  прежнему owner не разрешают устаревший fallback/reorder. Guard отменяет ещё не начатые действия и
  позднюю публикацию UI; уже начатую внешнюю запись он отменить не может.
- TA math8:68ffa68; registry8:e0b87dd. Теперь29 вычислений,30 доступных ТА с объёмом,34 доступных
  записи вместе с4MTP. Каталог127 ТА остаётся полным списком названий, остальные расчёты пока
  отключены с причинами.
- KLine fractional repaint и сохранение TA drag из0.3.18 включены в эту ветку.

## Годовой масштаб Historical Volatility

Оба adapters передают явный контекст через TechnicalRenderData. Для внутридневных интервалов и1D
используется365, для1W/1M —365/7 по проверенному правилу встроенного индикатора. Это вход расчёта;
он не сохраняется в instance и не выводится из плотности или видимого диапазона свечей. Один
instance переносится между таймфреймами без изменения его params.

Drive allowlist расширен только `expansionLength`, `contractionLength`, `middleLength`; строгая
валидация экземпляров сохраняется. Проверен JSON/Drive v2 roundtrip нестандартных BBW/UO/HV
параметров вместе с provider identity, панелями и старым v1 профилем.

## Доказательства и пределы

Первый общий `pnpm check`:672/672; build `aa46780921ea33f2`. Первый прогон нашёл устаревшую fixture
currency-search без обязательного preferences. Исправлена только fixture; production state не
ослаблялся. Повторный полный прогон зелёный. Отдельные native/context/portability tests:20/20. Логи
находятся в `vps/artifacts/release-0319-integration-check.log` и
`vps/artifacts/release-0319-integration-spec.log`.

Actual adapter fixtures подтверждают выходы29 общих формул в обоих движках, явный HV context,
сохранение камеры/данных и bounded layout. Они не заменяют настоящую браузерную проверку. Первый
браузерный прогон нашёл слишком большие SVG меню разделов и перехват кликов нижними панелями при
плотной легенде. Оба дефекта исправлены в `be490a7`; отдельная повторная приёмка
`vps/artifacts/release-0319-ui-fixes-qa/report.json` подтверждает компактное меню на desktop/mobile,
прокрутку девяти overlay, попадание в настройки каждого, сохранение камеры и отсутствие новых
запросов истории. Иконки меню дополнительно получили собственные размеры и stroke в `dc98e37`.

Guest recovery `549f17b` включён как `53fc5b7`. Raw guest переносится атомарно только в доказанно
пустое public-пространство; исходник остаётся. При занятом public доступны отдельный offline backup
и явный импорт с предупреждением. Bank/vault/session записи не копируются. Последняя исходная
проверка `6edd57e`:693/693 tests,39/39 strict specs, build `cae30ec3f52ee69b`, PR6 CI run16 PASS.
Параметры ТА имеют читаемые подписи RU/EN; collapsed badge учитывает overlay ТА.

Final browser QA в `vps/artifacts/guest-recovery-final-qa` подтвердила A raw17 и B occupied18:
исходный guest byte-exact, текущий public сохраняется; offline export, явный import и возврат
текущего backup работают. Для C genuine empty18 первый прогон нашёл blocker: автоматически созданная
инертная запись drive-v2:public считалась пользовательским содержимым. Узкий fix `be6dfc2` включён
как `3757264`, полный check697/697, spec39/39, build `9d68e99e91dea44d`, GitHub CI45723932977/run17
PASS. Независимое source review не нашло material bugs.

Повтор C из исходного сохранённого .18 baseline прошёл через обычную кнопку Обновить. Видимые
KLine/180/en/light и сохранённые gridfalse/font13 восстановлены; decision copied. Raw guest,
drive-device и весь drive-v2:public byte-exact прежние до и после reload, дублей нет. Исходный
baseline и ошибочный C-run сохраняются; их decision не удалялся ради теста.

Native IndexedDB D fixture подтвердила перенос view/drawing/PNG/history/coverage, неизменность
исходных bytes и отсутствие дублей после reload. Без include-history payload не читался; с ним
экспортированы исходные1152bytes с прежним SHA. Native DOMException quota через контролируемую
асинхронную IDB fault injection откатывает copies/decision, сохраняет source и оставляет рабочий
пустой public bootstrap, предупреждение и реальное скачивание без истории. Это контролируемый отказ
IDB, не заполнение пользовательского диска. Поздний DB callback/owner bounce и Blob await с реальным
UI import подавляют старый download/alert. Foreign/vault read trap не срабатывал.

Финальный smoke3757264 после C fix также прошёл: восстановленные настройки, затем реальный Bybit BTC
spot с RSI в обоих движках, разделы/rename/collapse/sidebar без изменения getView и без новых
запросов kline. На375px длинное меню300×242 без горизонтального overflow. Recovery card видна только
public, исчезает у контролируемого другого owner и возвращается обратно. Pristine C-fixed сохранён
отдельно от smoke. Итоговый отчёт: `vps/artifacts/guest-recovery-final-qa/report.json`. Настоящие
Google login/sync, bank credentials и публикация этой версии не проверялись.
