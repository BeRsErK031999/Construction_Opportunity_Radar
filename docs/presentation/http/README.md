# HTTP API

Внутренний HTTP API Construction Opportunity Radar предоставляет минимальный transport-контур MVP: liveness, реестр источников, персональные возможности, профиль пользователя, обратную связь и персональную feedback-сводку.

Текущий контракт — `v1`. Пути пока не содержат версию; каждый ответ передаёт `X-Radar-API-Version: 1`. Несовместимое изменение требует нового контракта и отдельного решения о versioning путей.

- [Private API v1](private/v1/README.md)
- [Навигация по контрактам](SUMMARY.md)

API предназначен только для loopback-доступа приложений модульного монолита. ART-022 добавил scoped service tokens, request/rate bounds и защитные response headers, но `X-Radar-User-Id` остаётся доверенным service assertion, поэтому публичная публикация требует отдельной схемы end-user authentication.
