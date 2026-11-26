import { getInterval, isIntervalId } from "../model/intervals/registry.js";
import { t } from "./messages.js";
import type { Locale } from "./preferences.js";

type Labels = readonly [ru: string, en: string];

const parameters: Readonly<Record<string, Labels>> = {
  adxSmoothing: ["Сглаживание ADX", "ADX smoothing"],
  anchor: ["Период привязки", "Anchor period"],
  atrLength: ["Период ATR", "ATR length"],
  bandMode: ["Единица ширины полос", "Band width units"],
  bandsStyle: ["Тип диапазона", "Bands Style"],
  baseLength: ["Период базовой линии", "Base line length"],
  bbMultiplier: ["Множитель полос Боллинджера", "Bollinger Bands multiplier"],
  centered: ["Показывать со смещением назад", "Center the plot"],
  closePartially: ["Учитывать частичное закрытие", "Include partial gap fills"],
  contractionLength: ["Период минимального сжатия", "Lowest contraction length"],
  conversionLength: ["Период линии конверсии", "Conversion line length"],
  dLength: ["Период %D", "%D length"],
  depth: ["Глубина поиска экстремума", "Pivot depth"],
  deviation: ["Минимальное отклонение", "Minimum deviation"],
  deviationPercent: ["Отклонение, %", "Deviation, %"],
  diLength: ["Период DI", "DI length"],
  displacement: ["Сдвиг, свечей", "Displacement in bars"],
  displayOffset: ["Сдвиг линии на графике", "Plot offset"],
  divisor: ["Делитель", "Divisor"],
  emaLength: ["Период EMA", "EMA length"],
  erLength: ["Период коэффициента эффективности", "Efficiency ratio length"],
  expansionLength: ["Период максимального расширения", "Highest expansion length"],
  extend: ["Продлевать уровни", "Extend levels"],
  factor: ["Множитель", "Factor"],
  fastLength: ["Быстрый период", "Fast length"],
  firstLength: ["Первый период сглаживания", "First smoothing length"],
  firstSignalLength: ["Первый сигнальный период", "First signal length"],
  group: ["Группа для оценки", "Rating group"],
  highLeft: ["Свечей слева от максимума", "Bars left of the high"],
  highRight: ["Свечей справа от максимума", "Bars right of the high"],
  increment: ["Шаг ускорения", "Increment"],
  intradayOnly: ["Только внутридневные интервалы", "Intraday intervals only"],
  jawLength: ["Период челюсти", "Jaw length"],
  jawOffset: ["Сдвиг челюсти", "Jaw offset"],
  kLength: ["Период %K", "%K length"],
  labelSide: ["Сторона подписей", "Label side"],
  left: ["Свечей слева от экстремума", "Bars left of the pivot"],
  length: ["Период", "Length"],
  levelFormat: ["Формат уровней", "Level format"],
  limitTrail: ["Ограничить длину линии гэпа", "Limit gap projection"],
  lipsLength: ["Период губ", "Lips length"],
  lipsOffset: ["Сдвиг губ", "Lips offset"],
  longLength: ["Длинный период", "Long length"],
  longRocLength: ["Длинный период ROC", "Long ROC Length"],
  lowLeft: ["Свечей слева от минимума", "Bars left of the low"],
  lowRight: ["Свечей справа от минимума", "Bars right of the low"],
  lowerDeviation: ["Нижнее отклонение", "Lower deviation"],
  maLength: ["Период сглаживания", "Smoothing length"],
  maType: ["Тип сглаживания", "Smoothing type"],
  maxGaps: ["Максимум гэпов", "Maximum gaps"],
  maximum: ["Максимальное ускорение", "Maximum"],
  maximumDistance: ["Максимум свечей между экстремумами", "Maximum bars between pivots"],
  maxTrailBars: ["Максимум свечей продления гэпа", "Maximum gap projection in bars"],
  middleLength: ["Средний период", "Middle length"],
  minimumDistance: ["Минимум свечей между экстремумами", "Minimum bars between pivots"],
  mode: ["Режим расчёта", "Calculation mode"],
  multiplier: ["Множитель", "Multiplier"],
  offset: ["Смещение", "Offset"],
  oscillatorAverage: ["Тип средней осциллятора", "Oscillator MA type"],
  overbought: ["Уровень перекупленности", "Overbought threshold"],
  oversold: ["Уровень перепроданности", "Oversold threshold"],
  percent: ["Отклонение, %", "Deviation, %"],
  pivotLegs: ["Свечей для поиска экстремума", "Pivot legs"],
  priceLength: ["Период RSI цены", "Price RSI length"],
  radius: ["Свечей с каждой стороны", "Bars on each side"],
  rankLength: ["Период ранга изменений", "Rank lookback"],
  reverse: ["Обратное направление", "Reverse"],
  right: ["Свечей справа от экстремума", "Bars right of the pivot"],
  roc1Length: ["Период ROC №1", "ROC length #1"],
  roc2Length: ["Период ROC №2", "ROC length #2"],
  roc3Length: ["Период ROC №3", "ROC length #3"],
  roc4Length: ["Период ROC №4", "ROC length #4"],
  rsiLength: ["Период RSI", "RSI Length"],
  secondLength: ["Второй период сглаживания", "Second smoothing length"],
  secondSignalLength: ["Второй сигнальный период", "Second signal length"],
  shortLength: ["Короткий период", "Short length"],
  shortRocLength: ["Короткий период ROC", "Short ROC Length"],
  showAverage: ["Средняя цена сессии", "Session average price"],
  showHiddenBearish: ["Скрытые медвежьи дивергенции", "Hidden bearish divergences"],
  showHiddenBullish: ["Скрытые бычьи дивергенции", "Hidden bullish divergences"],
  showLevels: ["Подписывать уровни", "Show levels"],
  showOpenClose: ["Цены открытия и закрытия", "Opening and closing prices"],
  showPrices: ["Подписывать цены", "Show prices"],
  showSessionNames: ["Названия сессий", "Session names"],
  showTickRange: ["Диапазон сессии в тиках", "Session range in ticks"],
  sigma: ["Сигма", "Sigma"],
  signalAverage: ["Тип сигнальной средней", "Signal MA type"],
  signalLength: ["Сигнальный период", "Signal length"],
  slowLength: ["Медленный период", "Slow length"],
  slowing: ["Сглаживание %K", "%K slowing"],
  sma1Length: ["Период SMA №1", "SMA length #1"],
  sma2Length: ["Период SMA №2", "SMA length #2"],
  sma3Length: ["Период SMA №3", "SMA length #3"],
  sma4Length: ["Период SMA №4", "SMA length #4"],
  smoothD: ["Сглаживание D", "D smoothing"],
  smoothK: ["Сглаживание K", "K smoothing"],
  source: ["Источник", "Source"],
  spanBLength: ["Период линии Span B", "Span B length"],
  start: ["Начальное ускорение", "Start"],
  stochasticLength: ["Период стохастика", "Stochastic Length"],
  stopLength: ["Период стоп-линии", "Stop length"],
  streakLength: ["Период RSI серии роста или падения", "Streak RSI length"],
  sumLength: ["Период суммирования", "Sum length"],
  teethLength: ["Период зубов", "Teeth length"],
  teethOffset: ["Сдвиг зубов", "Teeth offset"],
  upperDeviation: ["Верхнее отклонение", "Upper deviation"],
  useExponentialMa: ["Экспоненциальная средняя", "Use Exponential MA"],
  useLowerDeviation: ["Показывать нижнее отклонение", "Show lower deviation"],
  useUpperDeviation: ["Показывать верхнее отклонение", "Show upper deviation"],
  wmaLength: ["Период WMA", "WMA Length"]
};

const averageFields: Readonly<Record<string, Labels>> = {
  Average: ["Тип средней", "Average type"],
  Length: ["Период средней", "Average length"],
  Source: ["Источник средней", "Average source"]
};
const sessionFields: Readonly<Record<string, Labels>> = {
  Enabled: ["Показывать сессию", "Show session"],
  End: ["Окончание сессии", "Session end"],
  Name: ["Название сессии", "Session name"],
  Start: ["Начало сессии", "Session start"],
  TimeZone: ["Часовой пояс сессии", "Session time zone"]
};
const averageField = /^ma([1-4])(Average|Length|Source)$/;
const sessionField = /^session([1-3])(Enabled|End|Name|Start|TimeZone)$/;
const bandField = /^band(Multiplier)?([1-3])$/;
const levelField = /^level(\d+)$/;

const choices: Readonly<Record<string, Labels>> = {
  "Average True Range": ["Средний истинный диапазон", "Average True Range"],
  Both: ["В обе стороны", "Both"],
  Left: ["Влево", "Left"],
  None: ["Нет", "None"],
  Percent: ["Проценты", "Percent"],
  Range: ["Диапазон", "Range"],
  Right: ["Вправо", "Right"],
  "SMA + Bollinger Bands": ["SMA и полосы Боллинджера", "SMA + Bollinger Bands"],
  "True Range": ["Истинный диапазон", "True Range"],
  Values: ["Коэффициенты", "Values"],
  auto: ["Автоматически", "Automatic"],
  averages: ["Скользящие средние", "Moving averages"],
  "calendar-day": ["Календарный день", "Calendar day"],
  century: ["Век", "Century"],
  close: ["Закрытие", "Close"],
  cumulative: ["Накопительный", "Cumulative"],
  decade: ["Десятилетие", "Decade"],
  high: ["Максимум", "High"],
  "highest-high": ["По максимуму цены", "Highest high"],
  "highest-volume": ["По максимуму объёма", "Highest volume"],
  hl2: ["Среднее High и Low (HL2)", "High–low average (HL2)"],
  hlc3: ["Типичная цена (HLC3)", "Typical price (HLC3)"],
  low: ["Минимум", "Low"],
  "lowest-low": ["По минимуму цены", "Lowest low"],
  month: ["Месяц", "Month"],
  ohlc4: ["Среднее OHLC (OHLC4)", "OHLC average (OHLC4)"],
  open: ["Открытие", "Open"],
  oscillators: ["Осцилляторы", "Oscillators"],
  overall: ["Общая оценка", "Overall rating"],
  percent: ["Проценты", "Percentage"],
  quarter: ["Квартал", "Quarter"],
  regular: ["По отдельной свече", "Regular"],
  session: ["Торговая сессия", "Trading session"],
  "standard-deviation": ["Стандартное отклонение", "Standard deviation"],
  volume: ["Объём", "Volume"],
  week: ["Неделя", "Week"],
  year: ["Год", "Year"]
};
const movingAverage = /^(?:sma|ema|smma|wma|vwma)$/;

export function technicalParameterLabel(key: string, locale: Locale): string {
  const index = locale === "en" ? 1 : 0;
  if (Object.hasOwn(parameters, key)) return parameters[key]![index];
  const average = averageField.exec(key);
  if (average) return `${averageFields[average[2]!]![index]} ${average[1]}`;
  const session = sessionField.exec(key);
  if (session) return `${sessionFields[session[2]!]![index]} ${session[1]}`;
  const band = bandField.exec(key);
  if (band) {
    const title: Labels = band[1] ? ["Множитель полосы", "Band multiplier"] : ["Полоса", "Band"];
    return `${title[index]} ${band[2]}`;
  }
  const level = levelField.exec(key);
  if (level) return `${locale === "en" ? "Level" : "Уровень"} ${Number(level[1]) + 1}`;
  return key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function technicalChoiceLabel(value: string, locale: Locale): string {
  if (Object.hasOwn(choices, value)) return choices[value]![locale === "en" ? 1 : 0];
  if (movingAverage.test(value)) return value.toUpperCase();
  if (isIntervalId(value)) return t(getInterval(value).label, locale);
  return value;
}
