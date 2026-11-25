# Design

## Context

См. proposal.md. Прототип подтверждён браузерным QA до build2238c733d9d6e104. IndexedDB
`twiling-personal-terminal` v2 содержит preferences/drawings/images/history/coverage/vault. Миграция
не меняет форматы или ключи записей.

## Goals / Non-Goals

**Goals:** React владеет окнами и UI, TypeScript проверяет весь runtime, чистые функции остаются
проверяемыми отдельно. Существующие пользовательские сохранения и WS-поведение сохраняются.

**Non-Goals:** Google Drive, новые графические инструменты, смена IndexedDB/backup-формата,
банковский backend. Их развитие не совмещается с миграцией.

## Decisions

- Общие типы свечей, диапазонов, инструментов, рисунков/настроек и backup в `src/model/types.ts`;
  внешние JSON и DB записи проверяются на границе.
- Pure modules в `src/model`; банк/IndexedDB в `src/services`; chart adapters в `src/charts`; React
  UI и контроллеры в `src/screens/terminal`. Альтернатива «переименовать JS с any» отвергнута,
  поскольку не ловит ошибки.
- React-компоненты владеют целыми DOM-областями; ручное управление допускается только внутри chart
  adapter canvas. Таблица котировок получает typed view, стабильные ключи и обновления цифр без
  заливки.
- esbuild собирает статические ESM; tsc отдельно проверяет strict, allowJs:false,
  exactOptionalPropertyTypes, noUncheckedIndexedAccess. pnpmcheck включает формат, lint, typecheck,
  unit и build.
- PWA вычисляет base по URL документа, не по пути chunk. Список shell assets создаётся после сборки;
  обновление по кнопке после flush.
- Перед кодом архитектура проверена отдельным spec_architect; core/services/UI делегируются без
  пересечения файлов.

## Risks / Trade-offs

- [Старая сессия затрётся defaults] → bootstrap сначала восстанавливает профиль, запись разрешается
  после гидратации.
- [React и старый DOM-код владеют одними потомками] → перенос целой области, старый
  listener/renderer удаляется в том же изменении.
- [Дубли WS/RAF при remount] → явный start/dispose; проверка повторной установки и снятия.
- [Смена bundlepath ломает SW] → явный document base и smoke локального/доменного размещения.
- [KLine viewport после prepend прыгает] → сохранить timestamp+pixelFraction, восстановить на
  onDataReady; прежний исправленный сценарий повторить.
- [Новый домен — новый origin/пустая локальная база] → локальные данные переносятся
  экспортом/импортом; существующий localhost остаётся 5210; ключ пользователь вводит на новом
  устройстве/origin.

## Migration Plan

1. Зафиксировать typed models/services и тесты прежней математики/сериализации.
2. Перенести React shell, окна и canvas adapters с явным lifecycle.
3. Пройти pnpmcheck/specvalidate и независимое review.
4. Проверить обновление существующего QA-профиля, offline/импорт/WS/Fib/cache; архивировать только
   после принятия всех сценариев.
5. Публиковать статическую сборку с SHA/build и nginx rollback. При ошибке вернуть предыдущий
   release; IndexedDB не мигрировалась и остаётся совместимой.
