# Design

## Context

prepareProfileV2 читает raw records только того же owner. Bootstrap .18 выбирает public вместо
прежнего guest. Ready marker public уже мог появиться вместе с пустыми watchlist/market.

## Goals / Non-Goals

Goals: восстановить exact guest настройки/portable/history/coverage при пустом target; сохранить
source; предоставить офлайн backup при занятом target.

Non-Goals: bank-owner migration, чтение vault/session/device keys, молчаливая замена public,
сервер/релиз.

## Decisions

- Source и target фиксированы: raw guest и physical profile-v2:public. UI не принимает другие
  owners.
- Bootstrap вызывает adoption после prepareProfileV2(public), перед candidate.start, только для
  anonymous public.
- Пустота проверяется в одной RW транзакции preferences/drawings/images/history/coverage.
  Допускаются только ready marker и строго пустые bootstrap watchlist/market; любой layout, view,
  cache, документ либо неизвестный public-scoped key означает occupied.
- Exact keys/prefix ranges и ownerSymbol index читают только guest/source значения. Для поиска
  public данных читаются ключи, а не значения других владельцев. Vault и session/device key values
  не читаются.
- Решение occupied/source-empty/copied записывается отдельным local marker; повторный запуск не
  восстанавливает workspace после его явного очищения. Quota/corrupt/abort не оставляют частичной
  копии или success marker.
- Только allowlisted portable поля проходят существующий portable validator. История валидируется
  декодером, копируются исходные ArrayBuffer и coverage; images получают новый local id с прежним
  syncId. Source неизменён.
- Export читает raw guest без prepareProfileV2(guest), работает офлайн в anonymous public. Sticky
  owner/session/import guard действует до подтверждённого download callback. Есть RU/EN
  предупреждение о замене workspace явным импортом и сохранении текущего через Экспорт.
- Native commit — точка невозврата. Abort после него не отменяет доказанно завершённую копию;
  повторный запуск видит decision marker.
- Source-invalid и ошибка переноса не блокируют valid bootstrap. Только после реально пойманного
  QuotaExceededError adoption узкий cache-port допускает отсутствие записи пустого public bootstrap
  и пустого quote cache. Непустые/user writes, bank и прочие ошибки сохраняют обычный reject. Это
  позволяет выйти из неудавшегося переноса; доступность bank persistence при полной quota не
  обещается.
- Локализованное сообщение явно сообщает о несохранённом переносе и оставшейся копии/экспорте. При
  owner/import/abort границе старый candidate не продолжает активацию и не пишет поздний warning.
- До установки public candidate subscriber отменяет guest transfer через AbortSignal. После
  собственного profile commit import/revision лишь отменяет старое recovery warning: уже валидный
  client не закрывается при обычном выборе инструмента во время history await. Собственные
  owner/revision updates разрешены, bank lifecycle условия не расширены. Logout из уже существующего
  import barrier остаётся доступным и пропускает guest adoption для этого перехода.

## Risks / Trade-offs

Миграция истории может упереться в quota; атомарность сохраняет старые записи и позволяет recovery
export. Невалидный источник не копируется. Неизвестные public ключи считаются конфликтом
консервативно. Экспорт старых данных не заменяет текущий workspace; пользователь импортирует файл
явно.

## Open Questions

Нет; контракт согласован координатором до реализации.
