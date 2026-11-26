# Design

## Context

Exact base `0d17cf10a1a7f199d34d66235bd17352ca3f2627`. Pure math byte-identical
`780e9c5287153021b516b472fb1282b22f3b59a4`. Primary HTTP200/version35.0/hash102f0093 подтверждены
verified TLS; metadata-only `KELTNER_PRIMARY_CAPTURE.json` сохраняет только факты.

## Goals / Non-Goals

**Goals:** один новый KC, real boolean и три точных bandsStyle values, независимая basis readiness,
текущий v1 roundtrip.

**Non-Goals:** Donchian offset, G5/DB3/envelope3, fill settings persistence, native edits,
build/browser/release.

## Decisions

1. Keltner contract содержит required scalar params и narrow literal history union. Runtime вызывает
   reviewed math без общего warmup mask; проверяет reviewed metadata и сохраняет basis/upper/lower
   как получены.
2. EMA basis ready1, SMA readyLength. Bands ready max(basis, ATRlength/1/Length). Только
   SMA+TrueRange history finite max(Length,2); остальные recursive. Readiness не означает
   convergence на иной истории.
3. ParameterDefinition получает boolean и generic readonly nonempty string choices. Stored bool
   остаётся boolean, choice — exact canonical string; instance validator не выполняет coercion, code
   evaluation или normalization неизвестных значений. Старые PVO EMA/SMA definitions не меняются.
4. Settings хранит boolean draft как boolean, показывает настоящий checkbox существующего CSS16x16.
   Band choices имеют RU/EN labels, но сохраняют исходные canonical values. Params/pane edits не
   материализуют styles.
5. Все3 lines blue#2962FF, fill upper→lower #2196F3 opacity0.05 из source transparency95.
   Native-price policy явна и сохраняется в lower pane. Никаких hidden scale anchors/zero carrier;
   fill использует существующую реальную branch scale.
6. KC ограничен1M bars как существующие channel-price registrations; ALMA/LSMA window-product cap к
   KC не применяется. Transient calculation-limit даёт только null results, не params/backup.
   EMA/RMA linear, reviewed SMA O(N log L), kernel не меняется.
7. Drive добавляет только useExponentialMa и bandsStyle: четыре остальных keys уже разрешены.
   Instance schemaVersion1 и старые fifty witnesses не переписываются.

## Risks / Trade-offs

- Generic choices шире только metadata type → exact membership validator и regression всех4 PVO
  combinations.
- Полный registry count helper ещё pinned50 → собственные тесты проверяют old50 prefix+KC; root
  централизованно обновляет counts после review.
- Local gap/reset semantics могут отличаться от Pine skip-na → reuse math limits документированы,
  browser/Pine parity не заявляется.
- Source fill default поддержан, advanced fill settings текущий v1 не выражает → UI не добавляет
  ложное autosave.
