# Design

## Context

Текущие типы и контроллеры принадлежат TBank. Bybit foundation не импортирует их и не пишет в IDB.

## Decisions

- Ref хранит provider/category/native symbol; seriesId не содержит display ticker или market label.
- HTTP GET использует bound global fetch, credentials omit, timeout/abort и различимые ошибки.
- Catalog возвращается атомарно после cursor exhaustion; неизвестные symbolType не считаются crypto.
- Metadata TradFi сохраняется для отдельного будущего интерфейса без обещания владения акциями.
- REST и WS используют общие строгие numeric/candle/ticker normalizers.
- WS factory и scheduler внедряются для детерминированных тестов; один instance на category.
  Reconnect сбрасывает snapshot state. Spot подписки отправляются пачками не более10 topics.
- 2m/10m не подменяются другим интервалом. Provider switch и OKX здесь отсутствуют.

## Risks / Trade-offs

Нет browser/CORS smoke на этом этапе: UI ещё не подключён. Историческое покрытие и права на
публичную перераздачу не расширяются этим кодом. Общее сохранение и идентичность согласуются
отдельно.
