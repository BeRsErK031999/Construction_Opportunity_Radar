# RSS/HTTP source adapter

## Purpose

`rss-http-v1` converts an approved RSS 2.0 or Atom feed into `RawItemCandidate` records without writing PostgreSQL itself. The existing ingestion use case owns permission checks, immutable raw persistence, content hashing, and AI permission output.

No live endpoint was called while implementing ART-006. Offline fixtures are stored in `fixtures/rss/v1`.

## Permission boundary

The adapter supports only a registry `Source` with:

- `type: RSS`;
- `parserKind: RSS`;
- a positive polling interval;
- `enabled: true`;
- rights status other than `BLOCKED` or `REVIEW_REQUIRED`.

The adapter repeats the collection permission check before HTTP I/O. A source under review therefore cannot be fetched even if the adapter is called outside the normal ingestion use case. AI permission remains a separate registry decision and is enforced by the ingestion application layer.

## Default bounds

- request timeout: 10 seconds;
- maximum attempts per fetch: 3;
- retry: network/timeout plus HTTP `408`, `425`, `429`, `500`, `502`, `503`, `504`;
- exponential delay: 250 ms, bounded at 5 seconds, respecting a bounded `Retry-After`;
- rate limit: at least 1 second between requests to the same origin;
- maximum response body: 2 MiB;
- accepted media types: RSS, Atom, XML and plain-text XML;
- identifying user-agent: project name and public repository URL, configurable by composition root.

Oversized bodies, unsupported media, invalid XML, missing item URL/text, and exhausted retries produce typed errors without embedding response bodies, credentials, or transport details in their messages.

## Provenance

Every candidate preserves:

- feed URL and format;
- feed entry ID or GUID, falling back to the attributable item URL;
- original item URL;
- raw publication value and canonical timestamp when valid;
- title and unnormalized source text;
- adapter contract version.

Normalization remains a later versioned stage and does not overwrite this evidence.

## Verification

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit
```

Tests use injected HTTP outcomes and checked-in RSS/Atom fixtures. They cover parsing, end-to-end ingestion idempotency, permission refusal before I/O, timeout retry exhaustion, transient status retry, rate limiting, content-type rejection, malformed XML, response-size bounds, metrics, and safe error messages.

## Live smoke prerequisite

Before any live smoke, Денис supplies or confirms the source and rights basis, and Артём records it in the Source Registry with an explicit `ai_processing_allowed` value. Run only against that exact endpoint with an identifying user-agent. A successful smoke is evidence for the source, not proof of Gate G2 uptime or restart readiness.
