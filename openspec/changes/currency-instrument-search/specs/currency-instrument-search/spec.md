# Spec Delta

## Purpose

Обеспечивает поиск доступных валют Т‑Банка по реальным тикерам и привычным валютным обозначениям,
позволяя выбрать конкретную площадку и сохранить идентичность инструмента.

## ADDED Requirements

### Requirement: Currency catalog and category

Приложение SHALL загружать валюты и предоставлять категорию «Валюты»/Currencies с типом
«Валюта»/Currency. Валюта из fallback поиска SHALL определяться по instrumentType или
instrumentKind, без подмены индексом.

#### Scenario: Currency search

- **WHEN** пользователь ищет USD000UTSTOM в категории валют
- **THEN** поиск показывает валютные инструменты с их реальными тикерами и UID

#### Scenario: Enum fallback

- **WHEN** серверный поиск возвращает instrumentKind INSTRUMENT_TYPE_CURRENCY без каталога
- **THEN** результат имеет валютный тип и доступен в категории валют

### Requirement: Query aliases preserve identities

Поиск SHALL принимать USDRUB_TOM, USD/RUB и «доллар рубль» для релевантных USD000UTSTOM/USDRUB, а
EURRUB_TOM для EUR_RUB__TOM. Алиас SHALL применяться только к поиску. Разные UID одноимённых
инструментов SHALL оставаться отдельными результатами с площадкой MOEX/дилер.

#### Scenario: Two USD sources

- **WHEN** пользователь вводит USDRUB_TOM
- **THEN** CETS и дилерский USD000UTSTOM различимы по площадке, а выбор сохраняет реальный тикер и
  UID выбранного результата

### Requirement: Compatible catalog upgrade and backup

Старый кэш без валют SHALL обновляться без ожидания срока годности. Ошибка Currencies SHALL
сохранять прежние каталоги и работоспособную сессию. Валютный тип SHALL переноситься JSON/Drive
backup без изменения schemaVersion и без изменения ключей истории.

#### Scenario: Fresh legacy cache

- **WHEN** открывается свежий кэш без поля currencies
- **THEN** загружается недостающий каталог валют, а имеющиеся акции и фьючерсы сохраняются

#### Scenario: Currency endpoint fails

- **WHEN** запрос Currencies завершается ошибкой
- **THEN** сессия продолжает загрузку котировок, а существующие каталоги не обнуляются

#### Scenario: Currency backup

- **WHEN** экспортируется и импортируется валютный инструмент
- **THEN** его валютный тип, реальный тикер и UID сохраняются
