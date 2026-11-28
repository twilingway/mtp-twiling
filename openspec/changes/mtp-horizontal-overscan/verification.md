# Verification

Подробные source/build checkpoints, результаты и ограничения:
[release verification](../../../docs/RELEASE_0349_INTEGRATION.md).

Actual OffscreenCanvas: 24/24 случаев с нулевым RGBA расхождением, включая DPR 2.75, широкие
полупрозрачные линии, history boundaries и sampling 3000/3001. Жесты: 106 кадров без пустого МТП,
ранний refill при полном покрытии и переход coarse → exact. Production-модули МТП итоговой ветки
совпадают с проверенным `b0c9098`.

Физический телефон не использовался по актуальному указанию пользователя. Общий release gate — CI
точного head и smoke опубликованного сайта в PR32.
