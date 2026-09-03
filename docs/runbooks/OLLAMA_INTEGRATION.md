# Ollama integration runbook

## Purpose and boundary

This runbook connects the existing `AIProvider` boundary to an explicitly selected Ollama model. It does not install Ollama, pull a model, change Denis's host, enable live jobs or prove Gate G1 by itself. Денис provides physical access to the host; Артём owns configuration, benchmark execution and the model decision.

The adapter uses Ollama's documented non-streaming `POST /api/chat` structured-output request and reads installed models from `GET /api/tags`:

- <https://docs.ollama.com/api/chat>
- <https://docs.ollama.com/api/tags>

## Network layouts

Preferred, co-located:

```text
Radar process -> http://127.0.0.1:11434 -> Ollama on the same host
```

Preferred, separate host:

```text
Radar process -> local SSH-forwarded port -> Ollama loopback on Denis's host
```

Keep `OLLAMA_BASE_URL` loopback for an SSH tunnel. Do not bind Ollama directly to a public interface. A direct remote URL is accepted only with `OLLAMA_ALLOW_REMOTE_PRIVATE_HOST=true`, a private address/name and HTTPS. That mode additionally requires a valid certificate, a firewall allowlist for the Radar host, restricted egress and confirmation that the origin is not publicly routable. URL credentials, paths, queries and fragments are rejected.

## Configuration

The fake provider remains the zero-dependency default. Select Ollama explicitly:

```dotenv
AI_PROVIDER=ollama
OLLAMA_MODEL=deepseek-r1:8b
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_ALLOW_REMOTE_PRIVATE_HOST=false
OLLAMA_REQUEST_TIMEOUT_MS=300000
OLLAMA_HEALTH_TIMEOUT_MS=5000
OLLAMA_MAX_CONCURRENCY=1
OLLAMA_MAX_INPUT_CHARACTERS=24000
OLLAMA_CONTEXT_TOKENS=8192
OLLAMA_KEEP_ALIVE=5m
OLLAMA_SEED=42
```

Keep the exact model tag, context, seed, prompt version, dataset hash and commit identical when comparing models. Start with concurrency `1`; raise it only after measured GPU memory, latency and queue behavior show capacity. The adapter uses temperature `0`, disables streaming/thinking output, rejects redirects, caps responses at 1 MiB and does not retry internally.

## Preflight health

Run after the operator has installed Ollama and made the exact model available:

```powershell
$env:AI_PROVIDER = "ollama"
$env:OLLAMA_MODEL = "deepseek-r1:8b"
pnpm ai:health
```

A healthy result proves that the configured endpoint responds and the exact tag appears in `/api/tags`. It does not prove structured generation quality. A missing model returns `AI_UNAVAILABLE` without pulling it automatically. Timeout, rate limit, invalid response and transport failures use the stable `AIProvider` codes and safe messages.

## Benchmark sequence

First run the calibration split to verify the host and prompt. Keep holdout for the final comparison:

```powershell
pnpm benchmark:ai --provider ollama --model deepseek-r1:8b --split calibration
pnpm benchmark:ai --provider ollama --model deepseek-r1:14b --split calibration
```

After configuration is frozen, run both models on the same full set and save stdout outside Git or in an explicitly approved evidence location:

```powershell
pnpm benchmark:ai --provider ollama --model deepseek-r1:8b --split all
pnpm benchmark:ai --provider ollama --model deepseek-r1:14b --split all
```

The report includes dataset SHA, prompt/schema/analysis versions, structured validity, coverage/failures, event type, relevance, conservative factual support, hallucination count, latency and Ollama token/generation telemetry. Pass `--vram-peak-mib` only with a measured host-wide peak; do not estimate it from the model name.

Gate G1 remains open until both full reports use the same inputs and include measured VRAM, and the model decision is recorded from quality plus capacity. Gate G2's JSON-success threshold and live uptime/duplicate evidence remain separate.

## Failure and recovery

- `AI_INPUT_TOO_LARGE`: reduce permitted evidence at the application boundary or deliberately version the bound; do not truncate silently inside the adapter.
- `AI_INVALID_REQUEST`: check schema/model/runtime compatibility and request settings.
- `AI_INVALID_RESPONSE`: preserve the failed Analysis and inspect aggregate benchmark failures; never persist raw output as success.
- `AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_UNAVAILABLE`: let the durable job policy perform bounded retry. Check model presence, host load, tunnel/firewall and configured timeout.
- repeated out-of-memory or restart: stop live scheduling, lower concurrency/context, capture host evidence and rerun calibration before resuming.

Do not log prompts, source text, model response bodies or private endpoint details. After host or model changes, rerun `pnpm ai:health`, the calibration split and the normal repository quality checks.
