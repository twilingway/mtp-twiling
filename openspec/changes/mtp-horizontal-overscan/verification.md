# Verification

Подробные source/build checkpoints, результаты и ограничения:
[release verification](../../../docs/RELEASE_0349_INTEGRATION.md).

Actual OffscreenCanvas: 24/24 случаев с нулевым RGBA расхождением, включая DPR 2.75, широкие
полупрозрачные линии, history boundaries и sampling 3000/3001. Жесты: 106 кадров без пустого МТП,
ранний refill при полном покрытии и переход coarse → exact. Это checkpoint фиксированного запаса
`b0c9098`; после обратной связи пользователя target-padding меняется на половину ширины самого
графика, минимум 96 px, а prefetch использует половину фактического запаса. Protocol, core sampling,
painter и fence сохранены; адаптивный checkpoint проверяется отдельно.

Физический телефон не использовался по актуальному указанию пользователя. Общий release gate — CI
точного head и smoke опубликованного сайта в PR32.
