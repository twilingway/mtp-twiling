# Design

## Context

Exact base `f74c33d968d7ca258def096bfc2d731bbdf74b5f`; reviewed math
`49bfcf77c9a5200f8bcaf6d70735bd167c500b5f`. Первые45 definitions, старые numeric/history/v1
witnesses остаются исходными. Общая библиотека включает также Volume и четыре прежних legacy пункта.

## Goals / Non-Goals

**Goals:**47 computed definitions,48 technical catalog available с Volume и52 library entries;
корректные параметры/результаты и текущий v1 roundtrip.

**Non-Goals:** G5 advanced styles, новый format writer, DB migration, native edits, palette
activation старых индикаторов, release/browser claims.

## Decisions

1. Узкие `TrendPriceId`/`TrendPriceHistoryRequirement` добавляются к существующим unions. Adapter
   проверяет строки reviewed metadata и создаёт точные literal fields; generic string/cast не
   допускается.
2. SAR defaults0.02/0.02/0.2 и ST10/3, bounds копируются из reviewed presets. Новые definitions
   append после45, default overlay. Runtime отдельно dispatch к reviewed math до старого source
   switch, без общего masking, которое могло бы потерять ST direction/bodyMiddle.
3. Только SAR value и ST upTrend/downTrend являются UI outputs. ST value/direction/bodyMiddle
   остаются hidden raw series; два directional fills имеют opacity0.1. Native-price policy
   декларативна и не зависит от расположения.
4. v1 styles сохраняются без преобразований. SAR width означает relative point size; Line select
   скрыт, imported lineStyle сохраняется при любых patch/submit. Период не материализует styles.
   Fills пока имеют только runtime defaults; UI не обещает сохранение их настроек.
5. Drive allowlist расширяется ровно на atrLength/factor/start/increment/maximum; root validator
   проверяет оригинал до проекции. Никаких hidden keys/geometry в params/backup.

## Risks / Trade-offs

- Registration делает пункты локально computed; это не подтверждение Pine execution или
  native/browser G2 → независимый review и browser gate у root.
- Старые tests с global45/count и unavailable SAR/ST станут ожидать старое состояние → root
  обновляет counts один раз после integration; новый suite проверяет frozen old45 отдельно, fixtures
  не ослабляются.
- v1 не выражает fill/custom modes → новые G5 formats не реализуются и не маскируются
  автосохранением.

## Migration Plan

Source-only commit после scoped checks, root review и cherry-pick. Новые instances остаются
schemaVersion1; старые не переписываются. Откат registration commit удаляет возможность создания
новых двух; backup с unknown definition стандартно отвергается старым writer до записи.
