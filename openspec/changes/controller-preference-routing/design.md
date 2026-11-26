# Design

## Context

Frozen source .22 `50b5873`, base worktree `d3575934cb5c0ef051714eeeb20edad987ac72ac`. Read-only
proof: sibling `../route-race-review/REVIEW.md`, probe/output. Root принял оба blockers и
предварительно одобрил critical queue; затем одобрил bounded precommit coalescing для сохранения
existing newest-depth test (range5→30 до firstcommit не пишет key5).

## Goals / Non-Goals

**Goals:** cumulative independent routing fields, latest valid value одного поля, old-camera save до
изменения preferences, invalid-depth без отмены committed history, sticky scope и original valid.

**Non-Goals:** новый формат preferences/backup, UI/native/TA изменения, camera guard relaxation,
optimistic preferences до saveView, eager history до persistence, build/version/browser/deploy.

## Decisions

### 1. Bounded pending intent list и один critical drain

У каждого routing intent собственные patch/forceReload/original valid и sticky scope. Controller
захватывает owner/client/chartRevision/source viewKey/selected UID до enqueue; подписка замечает
owner/import/recovery/profile/revision/source boundary даже при bounce назад. Client проверяется и
после await без обязательного update. Listener снимается при завершении/cancel/error.

Critical drain выбирает только текущие eligible intents, создаёт historyDepthTransition **внутри**
critical на fresh state. Independent patches объединяются, одинаковые fields latest wins. Поздний
symbol без UID очищает более ранний pending UID перед pin по актуальным rows. Pure FIFO отвергнут:
он мог бы commit range5, сделать readyfalse, затем отклонить pending range30. Глобальный request
epoch отвергнут: rejected request не является новым committed route.

### 2. Сохранить порядок camera/flush/carry/commit

Порядок: save текущей old camera → editing.flush → per-record scope/original valid и depth.valid →
merge fresh → depth.carry с list version fence → повторный guard и merge fresh → commit → save
prefs. При новом intent во время save/flush/carry list version меняется; old carry guard
возвращаетfalse, drain заново выбирает valid records. Stale next не публикуется. После carry
повторный merge сохраняет concurrent nonrouting style/layout. Nonstrouting writes не ставятся в
routing queue.

При actual reload commit увеличивается committed generation и одним update публикуются preferences,
пустые candles/loadingfalse/**historyViewReadyfalse**. Поэтому depth select заблокирован и во время
await savePreferences. После synchronous update повторяется owner/scope guard до persistence.

### 3. Network вне critical queue

После savePreferences проверяются committed generation/owner/client/revision/import/market. History
promise сохраняет await semantics caller, но drain её не ждёт. Следующий routing critical commit
может начаться при старой network; existing reset/requestId/source guards останавливают stale data.
Rejected depth/valid record не увеличивает generation и не отменяет предыдущую committed загрузку.
Storage error передаётся исходному caller; drain после ошибки остаётся работоспособным.

После принятого commit original valid callback не применяется к его собственной destination:
watchlist fallback callback намеренно привязан к старым preferences. Base owner/session/import
fences продолжают действовать. Invalid callback до commit удаляет только свой
record/fields/forceReload.

## Risks / Trade-offs

- [Copy transaction уже committed перед late intent] → не удалять старый key и не выдумывать
  rollback; новый intent пересчитывается, final prefs latest; старый valid camera key может
  остаться.
- [Новый intent отменяет precommit carry] → повторный save/flush/carry; стоимость пропорциональна
  числу pending пользовательских intents, глобальных queues/таймеров/нового persistent state нет.
- [Preferences write failed после staging] → caller получает исходную ошибку, history до persist не
  стартует; последующая valid routing операция может продолжиться. Silent error swallowing нет.
- [Source-only тесты] → реальные controller/history/camera/effect implementations с fake DB/network/
  native boundary и hook scheduler; actual DOM/browser paint и integration build остаются root gate.

## Migration Plan

Миграции данных нет. Два production файла, test fixtures/regressions и docs/OpenSpec. Rollback
возвращает routing coordination без изменения схемы. Source commit передаётся root для отдельного
cherry-pick/full integration и fresh browser review; этот worktree ничего не публикует.
