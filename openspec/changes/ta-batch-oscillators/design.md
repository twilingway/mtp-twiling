## Context

Расчёты используют упорядоченные свечи терминала. Значения выровнены по входному ряду. Пропуски
задаются `null`.

## Decisions

- PMO сглаживает однобарный ROC дважды с коэффициентом `2/length` и масштабом ×10, затем
  рассчитывает сигнал обычной EMA. Минимальная длина специального сглаживания — 2.
- PPO поддерживает независимый выбор EMA или SMA для осциллятора и для сигнала. Сигнальная линия и
  гистограмма считаются по самому PPO.
- SMI строится на максимуме high и минимуме low за позиционное окно. SMII и SMIO используют двойное
  EMA-сглаживание изменения цены и его модуля. SMII возвращает отношение в масштабе −1…1 и сигнал,
  SMIO — разность этих выходов.
- RSI Коннора усредняет RSI цены, RSI знаковой серии и ранг доходности. Ранг учитывает строго
  меньшие доходности среди предыдущих `rankLength` баров. Для подсчёта ранга используется дерево
  Фенвика по координатам известных доходностей.
- Для DPO сдвиг равен `floor(length / 2) + 1` баров и применяется к позиции свечи. Обычный режим
  сравнивает закрытие с более ранней SMA. Центрированный режим сравнивает раннее закрытие с текущей
  SMA и выравнивает выход по свече закрытия.
- Рекурсивные EMA запускаются с первого известного значения. Пропущенное наблюдение не обновляет
  рекурсию и не порождает точку. Для прогрева реестр получит отдельно описанную глубину истории.

## Risks / Trade-offs

- Центрированный DPO пересчитывает историческую точку после появления правой части окна. Последние
  `floor(length / 2) + 1` свечей оставляются пустыми. Сдвиг уже применён к выходному массиву.
- Начальные значения рекурсивных расчётов могут зависеть от объёма загруженной истории.
  Многотаймфреймовый режим требует отдельного подключения источника свечей.

## References

- [TradingView PMO](https://www.tradingview.com/support/solutions/43000773010-price-momentum-oscillator-pmo/)
- [TradingView PPO](https://www.tradingview.com/support/solutions/43000502346-percentage-price-oscillator-ppo/)
- [TradingView SMI](https://www.tradingview.com/support/solutions/43000707882-stochastic-momentum-index-smi/)
- [TradingView SMII](https://www.tradingview.com/support/solutions/43000594669-smi-ergodic-indicator/)
- [TradingView SMIO](https://www.tradingview.com/support/solutions/43000594671-smi-ergodic-oscillator/)
- [TradingView Connors RSI](https://www.tradingview.com/support/solutions/43000502017-connors-rsi-crsi/)
- [Спецификация Connors Research](https://www.tradingmarkets.com/media/2012/CRHS.pdf)
- [TradingView DPO](https://www.tradingview.com/support/solutions/43000502246-detrended-price-oscillator-dpo/)
- [Входные параметры SMII и DPO из TradingView Advanced Charts](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.StudyOverrides/)
- [Обычный и центрированный расчёт DPO в Indie](https://indie-script.github.io/indicators/oscillators/built-in/Detrended%20Price%20Oscillator/)
