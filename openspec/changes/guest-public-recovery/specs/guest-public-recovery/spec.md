# Spec Delta

## Purpose

Сохраняет старое локальное анонимное рабочее пространство при смене namespace guest на public, не
заменяя новые данные и не затрагивая секреты.

## ADDED Requirements

### Requirement: Атомарное продолжение старого workspace

Приложение SHALL копировать exact raw guest в public только при доказанно пустом target, включая
portable данные и историю/coverage. Source SHALL сохраняться.

#### Scenario: Существующий ready marker

- **WHEN** guest содержит KLine/range180/light/gridfalse/font13, а public только ready marker и
  пустой bootstrap cache
- **THEN** public получает эти настройки в атомарной копии, source остаётся неизменённым

#### Scenario: Занятый public

- **WHEN** public содержит любой layout, включая defaults, либо другие данные
- **THEN** автоперенос не заменяет их и сохраняется решение конфликта

#### Scenario: Инертный Drive bootstrap версии .18

- **WHEN** public содержит только empty bootstrap и точный несвязанный drive-v2:public из пяти полей
  с совпадающим UUID drive-device
- **THEN** эти метаданные не блокируют guest adoption и не изменяются;
  linked/head/digest/pending/extra либо неверные UUID остаются occupied

### Requirement: Безопасный повтор и отмена

Приложение SHALL сохранять отдельное решение copied/occupied/source-empty и соблюдать
owner/import/abort границы. Ошибка до native commit SHALL откатывать всю копию.

#### Scenario: Quota или отмена

- **WHEN** транзакция копирования получает quota error или abort до commit
- **THEN** нет частичных public copies и success marker, source не изменён

#### Scenario: Явное очищение после конфликта

- **WHEN** ранее занятый public впоследствии очищен пользователем
- **THEN** прежнее решение не допускает неожиданного автоматического восстановления guest

#### Scenario: Неуспешный перенос не закрывает public

- **WHEN** источник повреждён или guest adoption отклонён из-за quota при valid lifecycle
- **THEN** public продолжает запуск, показывает сообщение и recovery export; только пустые cache
  writes после пойманной quota могут остаться несохранёнными

### Requirement: Изоляция локальных данных

Миграция SHALL читать только exact guest значения и scoped public данные, не читать
vault/session/device key values и не копировать настоящие bank owners.

#### Scenario: Соседний банковский профиль

- **WHEN** в DB есть bank records и секретные записи
- **THEN** их значения не читаются и не изменяются при guest recovery

### Requirement: Явный офлайн recovery export

Настройки SHALL предоставлять RU/EN экспорт прежнего guest без сети и без prepareProfileV2(guest),
только anonymous public, с предупреждением о последующем явном импорте.

#### Scenario: Переключение во время экспорта

- **WHEN** профиль или import boundary меняется до download после async чтения
- **THEN** устаревший download не начинается

#### Scenario: Восстановление файла

- **WHEN** пользователь скачивает старый workspace и явно импортирует файл
- **THEN** старые настройки восстанавливаются, исходный guest остаётся сохранённым
