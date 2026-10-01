# @logwolf/client-js — Overview

## Purpose

TypeScript/JavaScript client SDK for submitting events to and reading events from a Logwolf backend. Designed to be embedded in any web or Node.js application.

## Package info

| Field           | Value                          |
| --------------- | ------------------------------ |
| Package name    | `@logwolf/client-js`           |
| Current version | `1.1.1`                        |
| Entry point     | `dist/logwolf-client.js` (ESM) |
| Source          | `lib/`                         |
| Build tool      | Rollup + TypeScript            |

## Source layout

```
lib/
├── index.ts      # Public exports (Logwolf, LogwolfEvent, schemas)
├── client.ts     # Core Logwolf class — public API, batching, retry
├── event.ts      # LogwolfEvent helper class
└── schema.ts     # Zod schemas for config and API contracts
smoke/            # the contract check and smoke test, against the core
```

## Public API

```ts
const client = new Logwolf({
  baseUrl: 'https://your-logwolf.example.com',
  apiKey:  'lw_...',
  // optional
  flushInterval:    5000,   // ms between auto-flushes
  maxBatchSize:     100,
  sampleRate:       1.0,    // 0–1
  errorSampleRate:  1.0,
  timeout:          10000,  // fetch timeout in ms
});

client.capture({ name: 'user.signup', severity: 'INFO', data: { ... } });

await client.flush();    // force-send queued events
await client.destroy();  // flush + stop background timer

// Read-side: getAll/getOne need a key with the `read` scope, delete the `delete`
// scope. New keys only have `ingest` unless you pick more on /keys.
const events = await client.getAll({ page: 1, pageSize: 50 }); // pageSize ≤ MAX_PAGE_SIZE (100)
const event  = await client.getOne(id);                        // undefined if the project has no such event
await client.delete(id);
```

## Event flow

1. `capture()` validates the event with Zod and pushes it to an in-memory queue.
2. A background timer (default 5 s) batches queued events and `POST /logs/batch`.
3. Failed requests retry with exponential back-off (up to 3 attempts).
4. If the queue exceeds `maxBatchSize`, the oldest events are evicted (FIFO).

## Key design decisions

- **Fire-and-forget capture**: `capture()` is synchronous; actual delivery is asynchronous.
- **No singleton**: callers create their own `Logwolf` instances; multiple targets are supported.
- **Zod for runtime safety**: config and event payloads are validated at the boundary, so bad data surfaces early.
- **Sample rates**: general `sampleRate` and a separate `errorSampleRate` allow cheaper sampling of normal events while retaining all errors.

## Dependencies

| Dependency | Role                      |
| ---------- | ------------------------- |
| `zod`      | Runtime schema validation |

All dev dependencies (Rollup, Vitest, TypeScript, oxlint/oxfmt) are build-time only and not shipped.

## Development commands

```bash
pnpm test          # vitest (watch mode)
pnpm run coverage  # single run with coverage report
pnpm run build     # tsc + rollup → dist/
pnpm run lint      # oxlint
pnpm run format    # oxfmt
pnpm run typecheck # tsc --noEmit
pnpm run test:contract # lib/schema.ts against the core's OpenAPI spec
pnpm run test:smoke    # that, and the SDK against a running stack
```

## Relationship to the rest of Logwolf

The SDK talks directly to the **Broker** service (`POST /logs`, `POST /logs/batch`, `GET /logs`, `DELETE /logs`) using a Bearer token (`lw_` prefix). It has no knowledge of RabbitMQ, MongoDB, or any internal service — it only needs the public Broker URL and a valid API key.

## Smoke test

The SDK and the server live in different repositories, so they can drift apart. `.github/workflows/smoke.yml` checks both, on every pull request and daily, against the latest core release (or the one given when it is run by hand). It starts that release's published images with the core's own `docker-compose.yml` (broker, listener, logger, RabbitMQ and MongoDB, with `smoke/compose.yml` publishing the broker on `localhost:8080`) and runs two suites (`vitest.smoke.config.ts`):

- **contract** (`smoke/contract.smoke.ts`): holds `lib/schema.ts` against the release's `openapi.yaml`. What the SDK sends must fit the spec's request bodies, every event the spec allows must parse, every field of it must be read (or be listed as left out on purpose), and `MAX_PAGE`/`MAX_PAGE_SIZE` must be the spec's bounds. `smoke/json-schema.ts` compares zod's JSON Schema with the spec's.
- **smoke** (`smoke/sdk.smoke.ts`): sends events through the SDK, one with `create()` and a batch with `capture()` and `flush()`, reads them back with `getAll()` and `getOne()`, and deletes them. `smoke/setup.ts` first waits for `/health`, then creates a project and a key with every scope on the broker's internal routes.

Until the core has a release, the workflow warns and skips the test.

To run it locally, against a core checkout at `../logwolf`:

```bash
export SESSION_SECRET=smoke INTERNAL_API_SECRET=smoke MONGO_USERNAME=smoke MONGO_PASSWORD=smoke   RABBITMQ_USERNAME=smoke RABBITMQ_PASSWORD=smoke LOGWOLF_VERSION=1.2.0  # a published release
export COMPOSE_FILE=../logwolf/docker-compose.yml:smoke/compose.yml COMPOSE_PROJECT_NAME=logwolf-smoke
docker compose up -d broker listener logger mongo rabbitmq

LOGWOLF_OPENAPI=../logwolf/openapi.yaml LOGWOLF_SMOKE_INTERNAL_SECRET=smoke pnpm run test:smoke
docker compose down -v
```

The checkout should be at the release in `LOGWOLF_VERSION`, so the spec and the images agree. MongoDB and RabbitMQ keep their data in the checkout's `db-data/`; a checkout you also run Logwolf from has data there already, so use another. `pnpm run test:contract` needs only `LOGWOLF_OPENAPI`.
