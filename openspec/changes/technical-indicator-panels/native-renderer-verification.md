# Нативные renderer: реализация и source gate

Утверждённый adapter contract `949d752`, общий core и OutputStyle `1b060f8`/`096a8f3`. Подробности
интеграции: `docs/NATIVE_TECHNICAL_RENDERERS.md`.

## Реализовано

- LW и KLine получают вычисленные ряды из одного core, поддерживают несколько экземпляров, lower
  grouping/order, styles/opacity/dashes и декоративные reference levels.
- Настройки, видимость, collapse и pane order не пересоздают native chart и не сбрасывают камеру.
- Все скрытые экземпляры сохраняют геометрию группы, чтобы пользователь мог включить их из легенды.
- Нижние панели минимум 30 px, цена минимум 160 px при root minimum canvas height с разделителями.
  Viewport normalization не записывается в preferences.
- Layout callback вызывается только завершённым пользовательским resize. Отмена, смена viewport,
  программное restore и dispose не публикуют незавершённую правку.
- Глобальные KLine callbacks не удерживают источник закрытого графика; старый callback после
  повторного использования имени не читает нового owner.

## Проверенные сценарии

1. Все 13 общих формул совпадают с direct core result на реальных timestamp fixtures; прогрев не
   превращается в нули, дополнительных будущих баров нет.
2. Два RSI с разными периодами остаются независимыми в общей панели, изменения style/params
   сохраняют native instance identity.
3. Prepend и исправления старого бара пересчитывают полный вход без remount/fit.
4. Порядок lower panes и сохранённые ratios восстанавливаются при неизменных X spacing/offset; price
   bounds и hit conversion относятся к цене.
5. 100 экземпляров, 32 и 100 нижних групп сохраняют доступность и минимальную геометрию.
6. User resize публикует полный массив; cancel/blur/restore/viewport resize/dispose не публикуют
   draft.
7. Dispose и повторное использование KLine TA slot/XAxis изолируют старый context.
8. Legacy VOL/SMA20/EMA50/MTP/DRAWINGS сохраняются; installed KLine Canvas recovery охватывает
   созданные позже TA panes и освобождает удалённые canvas.

## Незакрытый gate

Общая UI интеграция, persist/Drive, runtime build и независимая browser QA двух движков выполняются
координатором. Общие tasks 2.3/3/5 не помечаются завершёнными по одним source fixtures.
